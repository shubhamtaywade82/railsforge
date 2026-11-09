import { describe, it, expect, vi } from 'vitest'
import * as vscode from 'vscode'
import { RubyAstParser } from '../src/indexer/RubyAstParser'
import { RefactoringEngine } from '../src/refactoring-intelligence/core/RefactoringEngine'
import {
  chooseBackgroundScope,
  currentObservation,
  hintsWithin,
  observationStateOf,
  ObservationStore,
  recordRefinement,
  scopeText,
  textHash,
} from '../src/refactoring-intelligence/core/ObservationStore'
import type { Recommendation, RefactorTarget, ScopeRef } from '../src/refactoring-intelligence/core/types'
import type { RefactoringAdvisor } from '../src/refactoring-intelligence/core/RefactoringAdvisor'
import { BackgroundHints } from '../src/refactoring-intelligence/vscode/BackgroundHints'

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

/** A fingerprint that is the same for every scope: the tests that care about it override it. */
const steady = async () => 'fp-1'

function rec(id: string, scope: ScopeRef, confidence: Recommendation['confidence'] = 'medium'): Recommendation {
  return {
    id,
    source: 'ai',
    candidateIds: ['c1'],
    path: PATH,
    scope,
    title: `hint ${id}`,
    problem: 'p',
    evidence: [],
    confidence,
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

  it('changes the hash when the text changes, and keeps it when it does not', () => {
    expect(textHash('a')).not.toBe(textHash('b'))
    expect(textHash('same')).toBe(textHash('same'))
  })
})

describe('ObservationStore: three states', () => {
  it('is unobserved when there is no entry, observed with recommendations, or observed without them', async () => {
    const store = new ObservationStore()
    expect(await currentObservation(store, PATH, SOURCE, GROSS, steady)).toBeUndefined()

    store.put(PATH, GROSS, scopeText(SOURCE, GROSS), 'fp-1', [rec('r1', GROSS)])
    const withRecs = await currentObservation(store, PATH, SOURCE, GROSS, steady)
    expect(withRecs && observationStateOf(withRecs)).toBe('observed_with_recommendations')

    store.put(PATH, NET, scopeText(SOURCE, NET), 'fp-1', [], ['one step only'])
    const without = await currentObservation(store, PATH, SOURCE, NET, steady)
    expect(without && observationStateOf(without)).toBe('observed_without_recommendations')
    expect(without?.reasons).toEqual(['one step only'])
  })

  it('treats an observation as stale when the scope text changed', async () => {
    const store = new ObservationStore()
    store.put(PATH, GROSS, scopeText(SOURCE, GROSS), 'fp-1', [rec('r1', GROSS)])
    const edited = SOURCE.replace('base = x * 2', 'base = x * 3')
    expect(await currentObservation(store, PATH, edited, GROSS, steady)).toBeUndefined()
  })

  it('treats an observation as stale when the context fingerprint changed, even if the scope text did not', async () => {
    const store = new ObservationStore()
    store.put(PATH, GROSS, scopeText(SOURCE, GROSS), 'fp-1', [rec('r1', GROSS)])
    // The constant it references, defined in another file, changed: the advice no longer describes it.
    expect(await currentObservation(store, PATH, SOURCE, GROSS, async () => 'fp-2')).toBeUndefined()
    expect(await currentObservation(store, PATH, SOURCE, GROSS, async () => 'fp-1')).toBeDefined()
  })

  it('finds the observation after the scope moves, because the key is the name, not the line', async () => {
    const store = new ObservationStore()
    store.put(PATH, GROSS, scopeText(SOURCE, GROSS), 'fp-1', [rec('r1', GROSS)])
    // Thirty-eight filler lines push the same four lines down to 39-42.
    const moved = { ...GROSS, startLine: 39, endLine: 42 }
    const shifted = `${'# filler\n'.repeat(38)}${scopeText(SOURCE, GROSS)}`
    expect(await currentObservation(store, PATH, shifted, moved, steady)).toBeDefined()
  })

  it('survives a reload: a store restored from its snapshot answers the same way', async () => {
    const first = new ObservationStore()
    first.put(PATH, GROSS, scopeText(SOURCE, GROSS), 'fp-1', [rec('r1', GROSS)], ['why'])
    const restored = new ObservationStore(JSON.parse(JSON.stringify(first.snapshot())))
    const entry = await currentObservation(restored, PATH, SOURCE, GROSS, steady)
    expect(entry?.recommendations).toHaveLength(1)
    expect(entry?.reasons).toEqual(['why'])
  })

  it('ignores a snapshot it does not recognise, and entries missing a fingerprint', () => {
    expect(new ObservationStore({ version: 2, entries: [] } as never).snapshot().entries).toEqual([])
    expect(new ObservationStore({ version: 1, entries: [{ key: 'k', scopeHash: 'h', recommendations: [] }] } as never).snapshot().entries).toEqual([])
  })

  it('keeps only the most recent scopes when it is full', () => {
    const store = new ObservationStore(undefined, 2)
    store.put(PATH, GROSS, 'g', 'f', [], [], 1)
    store.put(PATH, NET, 'n', 'f', [], [], 2)
    store.put(PATH, CLASS, 'c', 'f', [], [], 3)
    expect(store.snapshot().entries.map(e => e.scope.name).sort()).toEqual(['Pricing', 'net'])
  })

  it('notifies listeners on each change, and stops after unsubscribe', () => {
    const store = new ObservationStore()
    const listener = vi.fn()
    const unsubscribe = store.onDidChange(listener)
    store.put(PATH, GROSS, scopeText(SOURCE, GROSS), 'f', [])
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    store.put(PATH, NET, scopeText(SOURCE, NET), 'f', [])
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('recordRefinement and hintsWithin', () => {
  it('stores each recommendation under its own scope, and the reviewed target with the AI\'s reasons', async () => {
    const store = new ObservationStore()
    await recordRefinement(store, PATH, SOURCE, CLASS, [rec('r1', GROSS)], [{ reason: 'the class is cohesive' }], steady)

    expect((await currentObservation(store, PATH, SOURCE, GROSS, steady))?.recommendations.map(r => r.id)).toEqual(['r1'])
    const classEntry = await currentObservation(store, PATH, SOURCE, CLASS, steady)
    expect(classEntry && observationStateOf(classEntry)).toBe('observed_without_recommendations')
    expect(classEntry?.reasons).toEqual(['the class is cohesive'])
    expect(await currentObservation(store, PATH, SOURCE, NET, steady)).toBeUndefined()
  })

  it('records a review that found nothing at all, so the same code is not asked about again', async () => {
    const store = new ObservationStore()
    await recordRefinement(store, PATH, SOURCE, GROSS, [], [{ reason: 'one step' }], steady)
    const entry = await currentObservation(store, PATH, SOURCE, GROSS, steady)
    expect(entry && observationStateOf(entry)).toBe('observed_without_recommendations')
  })

  it('gathers a class target\'s observations from the methods inside it, but not from outside it', async () => {
    const scopes = [CLASS, GROSS, NET]
    const store = new ObservationStore()
    await recordRefinement(store, PATH, SOURCE, GROSS, [rec('r1', GROSS)], [], steady)
    await recordRefinement(store, PATH, SOURCE, NET, [rec('r2', NET)], [], steady)

    expect((await hintsWithin(store, PATH, SOURCE, scopes, CLASS, steady)).observed.map(r => r.id).sort()).toEqual(['r1', 'r2'])
    expect((await hintsWithin(store, PATH, SOURCE, scopes, NET, steady)).observed.map(r => r.id)).toEqual(['r2'])
  })

  it('never counts low-confidence items as observed hints, and does not call the target reviewed when the AI proposed something there', async () => {
    const store = new ObservationStore()
    await recordRefinement(store, PATH, SOURCE, GROSS, [rec('low', GROSS, 'low')], [], steady)
    const within = await hintsWithin(store, PATH, SOURCE, [GROSS], GROSS, steady)
    expect(within.observed).toEqual([])
    expect(within.reviewed).toBeUndefined()
  })

  it('reports the AI\'s reasons for a target it reviewed and left alone', async () => {
    const store = new ObservationStore()
    await recordRefinement(store, PATH, SOURCE, CLASS, [], [{ reason: 'cohesive' }], steady)
    const within = await hintsWithin(store, PATH, SOURCE, [CLASS, GROSS], CLASS, steady)
    expect(within.observed).toEqual([])
    expect(within.reviewed).toEqual(['cohesive'])
  })
})

describe('chooseBackgroundScope', () => {
  it('chooses the highest-ranked scope with no current observation', async () => {
    const store = new ObservationStore()
    const ranked = [rec('r1', GROSS), rec('r2', NET)]
    expect(await chooseBackgroundScope(PATH, SOURCE, ranked, store, steady)).toEqual(GROSS)

    store.put(PATH, GROSS, scopeText(SOURCE, GROSS), 'fp-1', [])
    expect(await chooseBackgroundScope(PATH, SOURCE, ranked, store, steady)).toEqual(NET)
  })

  it('asks again when a scope went stale through its context, not only through its own text', async () => {
    const store = new ObservationStore()
    store.put(PATH, GROSS, scopeText(SOURCE, GROSS), 'fp-1', [])
    const ranked = [rec('r1', GROSS)]
    expect(await chooseBackgroundScope(PATH, SOURCE, ranked, store, steady)).toBeUndefined()
    expect(await chooseBackgroundScope(PATH, SOURCE, ranked, store, async () => 'fp-2')).toEqual(GROSS)
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

  const LONG = [
    'class Pricing',
    '  def gross(x)',
    ...Array.from({ length: 16 }, (_, i) => `    v_${i} = x + ${i}`),
    '  end',
    'end',
    '',
  ].join('\n')

  function harness(options: {
    enabled?: boolean
    refine?: (input: unknown) => Promise<unknown>
    debounceMs?: number
  } = {}) {
    const engine = new RefactoringEngine(new RubyAstParser())
    const observations = new ObservationStore()
    const refine = vi.fn(options.refine ?? (async () => ({ ok: true, value: { recommendations: [], skipped: [] } })))
    const fingerprint = vi.fn(async () => 'fp-1')
    const advisor = { refine, fingerprint } as unknown as RefactoringAdvisor
    const hints = new BackgroundHints({
      engine,
      advisor,
      observations,
      pathOf: uri => uri.fsPath.replace('/proj/', ''),
      enabled: () => options.enabled ?? true,
      debounceMs: options.debounceMs ?? 10,
    })
    return { hints, refine, observations }
  }

  it('does nothing while the setting is off, even when a file is saved', async () => {
    const { hints, refine } = harness({ enabled: false })
    hints.enqueue(fakeDocument(LONG))
    await hints.whenIdle()
    expect(refine).not.toHaveBeenCalled()
  })

  it('asks the AI about one unobserved scope, then records the answer so the same code is not asked again', async () => {
    const { hints, refine, observations } = harness()
    hints.enqueue(fakeDocument(LONG))
    await hints.whenIdle()
    expect(refine).toHaveBeenCalledTimes(1)
    expect(refine.mock.calls[0][0]).toMatchObject({ path: PATH, scope: { kind: 'method', name: 'gross' } })
    expect(observations.snapshot().entries).toHaveLength(1)

    hints.enqueue(fakeDocument(LONG))
    await hints.whenIdle()
    expect(refine).toHaveBeenCalledTimes(1)
  })

  it('records nothing when the AI is unavailable, so the next save tries again', async () => {
    const { hints, observations } = harness({ refine: async () => ({ ok: false, reason: 'model-unavailable', message: 'no model' }) })
    hints.enqueue(fakeDocument(LONG))
    await hints.whenIdle()
    expect(observations.snapshot().entries).toEqual([])
  })

  it('debounces a burst of saves to one file into one queued review', async () => {
    vi.useFakeTimers()
    try {
      const { hints, refine } = harness({ debounceMs: 2_000 })
      for (let i = 0; i < 5; i++) {hints.onDidSave(fakeDocument(LONG))}
      await vi.advanceTimersByTimeAsync(2_500)
      await hints.whenIdle()
      expect(refine).toHaveBeenCalledTimes(1)
      hints.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('queues a save of another file while a review is running, instead of dropping it', async () => {
    const releases: Array<() => void> = []
    const { hints, refine } = harness({
      refine: () => new Promise(resolve => {
        releases.push(() => resolve({ ok: true, value: { recommendations: [], skipped: [] } }))
      }),
    })
    hints.enqueue(fakeDocument(LONG, 'app/services/first.rb'))
    hints.enqueue(fakeDocument(LONG, 'app/services/second.rb'))
    await vi.waitFor(() => expect(refine).toHaveBeenCalledTimes(1))
    expect(refine.mock.calls[0][0]).toMatchObject({ path: 'app/services/first.rb' })

    releases.shift()?.()
    await vi.waitFor(() => expect(refine).toHaveBeenCalledTimes(2))
    expect(refine.mock.calls[1][0]).toMatchObject({ path: 'app/services/second.rb' })

    releases.shift()?.()
    await hints.whenIdle()
    expect(refine).toHaveBeenCalledTimes(2)
  })

  it('reviews a document queued twice once, with its newest text', async () => {
    const release: { fn?: () => void } = {}
    const { hints, refine } = harness({
      refine: () => new Promise(resolve => {
        release.fn = () => resolve({ ok: true, value: { recommendations: [], skipped: [] } })
      }),
    })
    hints.enqueue(fakeDocument(LONG, 'app/services/first.rb'))
    hints.enqueue(fakeDocument(LONG, 'app/services/second.rb'))
    const newest = LONG.replace('v_0 = x + 0', 'v_0 = x + 99')
    hints.enqueue(fakeDocument(newest, 'app/services/second.rb'))

    await vi.waitFor(() => expect(refine).toHaveBeenCalledTimes(1))
    release.fn?.()
    await vi.waitFor(() => expect(refine).toHaveBeenCalledTimes(2))
    expect(refine.mock.calls[1][0].content).toContain('v_0 = x + 99')
    release.fn?.()
    await hints.whenIdle()
    expect(refine).toHaveBeenCalledTimes(2)
  })
})
