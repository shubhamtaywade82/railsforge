import { describe, it, expect, vi } from 'vitest'
import * as vscode from 'vscode'
import { RubyAstParser } from '../src/indexer/RubyAstParser'
import { RefactoringEngine } from '../src/refactoring-intelligence/core/RefactoringEngine'
import {
  chooseBackgroundScope,
  observedFor,
  observedWithin,
  ObservationStore,
  recordRefinement,
  scopeText,
  textHash,
} from '../src/refactoring-intelligence/core/ObservationStore'
import type { Recommendation, RefactorTarget, ScopeRef } from '../src/refactoring-intelligence/core/types'
import { BackgroundHints } from '../src/refactoring-intelligence/vscode/BackgroundHints'
import type { RefactoringAdvisor } from '../src/refactoring-intelligence/core/RefactoringAdvisor'

const PATH = 'app/services/pricing.rb'
const SOURCE = [
  'class Pricing', // 1
  '  def gross(x)', // 2
  '    base = x * 2', // 3
  '    base + 1', // 4
  '  end', // 5
  '  def net(x)', // 6
  '    x - 1', // 7
  '  end', // 8
  'end', // 9
  '',
].join('\n')

const GROSS: ScopeRef = { kind: 'method', name: 'gross', className: 'Pricing', startLine: 2, endLine: 5 }
const NET: ScopeRef = { kind: 'method', name: 'net', className: 'Pricing', startLine: 6, endLine: 8 }
const CLASS: ScopeRef = { kind: 'class', name: 'Pricing', startLine: 1, endLine: 9 }

function rec(id: string, scope: ScopeRef, title = `hint ${id}`): Recommendation {
  return {
    id,
    source: 'ai',
    candidateIds: ['c1'],
    path: PATH,
    scope,
    title,
    problem: 'p',
    evidence: [],
    confidence: 'medium',
    priority: 'high',
    technique: { id: 'extract-method', name: 'Extract Method' },
    design: 'd',
    alternatives: [],
    benefit: 'b',
    risk: 'r',
    affectedFiles: [PATH],
    steps: [],
    verification: [],
  }
}

describe('scope text and hashes', () => {
  it('slices exactly the lines a scope covers', () => {
    expect(scopeText(SOURCE, GROSS)).toBe('  def gross(x)\n    base = x * 2\n    base + 1\n  end')
  })

  it('changes the hash when the text changes, and keeps it when only the line numbers move', () => {
    expect(textHash('a')).not.toBe(textHash('b'))
    expect(textHash('same')).toBe(textHash('same'))
  })
})

describe('ObservationStore', () => {
  it('returns the observation while the scope text is unchanged', () => {
    const store = new ObservationStore()
    store.put(PATH, GROSS, scopeText(SOURCE, GROSS), [rec('r1', GROSS)])
    expect(store.get(PATH, GROSS, scopeText(SOURCE, GROSS))?.map(r => r.title)).toEqual(['hint r1'])
  })

  it('returns undefined once the scope text has changed, so a stale hint is never shown', () => {
    const store = new ObservationStore()
    store.put(PATH, GROSS, scopeText(SOURCE, GROSS), [rec('r1', GROSS)])
    const edited = SOURCE.replace('base = x * 2', 'base = x * 3')
    expect(store.get(PATH, GROSS, scopeText(edited, GROSS))).toBeUndefined()
  })

  it('finds the observation after the scope moves, because the key is the name, not the line', () => {
    const store = new ObservationStore()
    store.put(PATH, GROSS, scopeText(SOURCE, GROSS), [rec('r1', GROSS)])
    // Thirty-eight filler lines push the same four lines down to 39-42.
    const moved = { ...GROSS, startLine: 39, endLine: 42 }
    const shifted = `${'# filler\n'.repeat(38)}${scopeText(SOURCE, GROSS)}`
    expect(store.get(PATH, moved, scopeText(shifted, moved))).toHaveLength(1)
  })

  it('keeps "observed, nothing to change" distinct from "never observed"', () => {
    const store = new ObservationStore()
    expect(store.get(PATH, NET, scopeText(SOURCE, NET))).toBeUndefined()
    store.put(PATH, NET, scopeText(SOURCE, NET), [])
    expect(store.get(PATH, NET, scopeText(SOURCE, NET))).toEqual([])
  })

  it('survives a reload: a store restored from its snapshot answers the same way', () => {
    const first = new ObservationStore()
    first.put(PATH, GROSS, scopeText(SOURCE, GROSS), [rec('r1', GROSS)])
    const restored = new ObservationStore(JSON.parse(JSON.stringify(first.snapshot())))
    expect(restored.get(PATH, GROSS, scopeText(SOURCE, GROSS))).toHaveLength(1)
  })

  it('ignores a snapshot it does not recognise, rather than failing', () => {
    expect(new ObservationStore({ version: 2, entries: [] } as never).snapshot().entries).toEqual([])
    expect(new ObservationStore({ version: 1, entries: [{ nonsense: true }] } as never).snapshot().entries).toEqual([])
  })

  it('keeps only the most recent scopes when it is full', () => {
    const store = new ObservationStore(undefined, 2)
    store.put(PATH, GROSS, 'g', [], 1)
    store.put(PATH, NET, 'n', [], 2)
    store.put(PATH, CLASS, 'c', [], 3)
    const keys = store.snapshot().entries.map(e => e.scope.name)
    expect(keys.sort()).toEqual(['Pricing', 'net'])
  })

  it('notifies listeners on each change, and stops after unsubscribe', () => {
    const store = new ObservationStore()
    const listener = vi.fn()
    const unsubscribe = store.onDidChange(listener)
    store.put(PATH, GROSS, scopeText(SOURCE, GROSS), [])
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    store.put(PATH, NET, scopeText(SOURCE, NET), [])
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('recordRefinement and observedWithin', () => {
  it('stores each recommendation under its own scope, and an empty observation for the target when nothing was recommended there', () => {
    const store = new ObservationStore()
    recordRefinement(store, PATH, SOURCE, CLASS, [rec('r1', GROSS)])

    expect(observedFor(store, PATH, SOURCE, GROSS).map(r => r.id)).toEqual(['r1'])
    expect(store.get(PATH, CLASS, scopeText(SOURCE, CLASS))).toEqual([])
    expect(store.get(PATH, NET, scopeText(SOURCE, NET))).toBeUndefined()
  })

  it('gathers a class target\'s observations from the methods inside it, but not from outside it', () => {
    const scopes = [CLASS, GROSS, NET]
    const store = new ObservationStore()
    recordRefinement(store, PATH, SOURCE, GROSS, [rec('r1', GROSS)])
    recordRefinement(store, PATH, SOURCE, NET, [rec('r2', NET)])

    expect(observedWithin(store, PATH, SOURCE, scopes, CLASS).map(r => r.id).sort()).toEqual(['r1', 'r2'])
    expect(observedWithin(store, PATH, SOURCE, scopes, NET).map(r => r.id)).toEqual(['r2'])
  })
})

describe('chooseBackgroundScope', () => {
  it('chooses the highest-ranked scope with no observation for its current text', () => {
    const store = new ObservationStore()
    const ranked = [rec('r1', GROSS), rec('r2', NET)]
    expect(chooseBackgroundScope(PATH, SOURCE, ranked, store)).toEqual(GROSS)

    store.put(PATH, GROSS, scopeText(SOURCE, GROSS), [])
    expect(chooseBackgroundScope(PATH, SOURCE, ranked, store)).toEqual(NET)
  })

  it('chooses nothing once every ranked scope is observed, and asks again only when a scope changes', () => {
    const store = new ObservationStore()
    const ranked = [rec('r1', GROSS)]
    store.put(PATH, GROSS, scopeText(SOURCE, GROSS), [])
    expect(chooseBackgroundScope(PATH, SOURCE, ranked, store)).toBeUndefined()

    const edited = SOURCE.replace('base = x * 2', 'base = x * 9')
    expect(chooseBackgroundScope(PATH, edited, ranked, store)).toEqual(GROSS)
  })
})

describe('BackgroundHints', () => {
  function fakeDocument(text: string, file = PATH): vscode.TextDocument {
    return {
      languageId: 'ruby',
      uri: { fsPath: `/proj/${file}`, toString: () => `file:///proj/${file}` },
      getText: () => text,
    } as unknown as vscode.TextDocument
  }

  function harness(options: { enabled?: boolean; refine?: (scope: RefactorTarget) => Promise<unknown> } = {}) {
    const engine = new RefactoringEngine(new RubyAstParser())
    const observations = new ObservationStore()
    const refine = vi.fn(options.refine ?? (async () => ({ ok: true, value: { recommendations: [], skipped: [] } })))
    const advisor = { refine } as unknown as RefactoringAdvisor
    const hints = new BackgroundHints({
      engine,
      advisor,
      observations,
      pathOf: uri => uri.fsPath.replace('/proj/', ''),
      enabled: () => options.enabled ?? true,
      debounceMs: 10,
    })
    return { hints, refine, observations }
  }

  const LONG = [
    'class Pricing',
    '  def gross(x)',
    ...Array.from({ length: 16 }, (_, i) => `    v_${i} = x + ${i}`),
    '  end',
    'end',
    '',
  ].join('\n')

  it('does nothing while the setting is off, even on save', async () => {
    const { hints, refine } = harness({ enabled: false })
    await hints.review(fakeDocument(LONG))
    expect(refine).not.toHaveBeenCalled()
  })

  it('asks the AI about one unobserved scope, then records the answer so the same code is not asked again', async () => {
    const { hints, refine, observations } = harness()
    await hints.review(fakeDocument(LONG))
    expect(refine).toHaveBeenCalledTimes(1)
    expect(refine.mock.calls[0][0]).toMatchObject({ path: PATH, scope: { kind: 'method', name: 'gross' } })

    await hints.review(fakeDocument(LONG))
    expect(refine).toHaveBeenCalledTimes(1)
    expect(observations.snapshot().entries).toHaveLength(1)
  })

  it('records nothing when the AI is unavailable, so the next save tries again', async () => {
    const { hints, observations } = harness({ refine: async () => ({ ok: false, reason: 'model-unavailable', message: 'no model' }) })
    await hints.review(fakeDocument(LONG))
    expect(observations.snapshot().entries).toEqual([])
  })

  it('debounces a burst of saves into one review', async () => {
    vi.useFakeTimers()
    try {
      const { hints, refine } = harness()
      for (let i = 0; i < 5; i++) {hints.onDidSave(fakeDocument(LONG))}
      await vi.advanceTimersByTimeAsync(50)
      expect(refine).toHaveBeenCalledTimes(1)
      hints.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not start a second review while one is running', async () => {
    let finish: () => void = () => {}
    const { hints, refine } = harness({
      refine: () => new Promise(resolve => { finish = () => resolve({ ok: true, value: { recommendations: [], skipped: [] } }) }),
    })
    const first = hints.review(fakeDocument(LONG))
    await hints.review(fakeDocument(LONG))
    expect(refine).toHaveBeenCalledTimes(1)
    finish()
    await first
  })
})
