import { describe, it, expect } from 'vitest'
import { RubyAstParser } from '../src/indexer/RubyAstParser'
import { RefactoringEngine } from '../src/refactoring-intelligence/core/RefactoringEngine'
import type { Candidate, CandidateKind, Recommendation, ScopeRef } from '../src/refactoring-intelligence/core/types'
import { ADVISOR_LIMITS } from '../src/refactoring-intelligence/core/types'
import {
  buildDeterministicRecommendations,
  candidatesInScope,
  confidenceOf,
  priorityOf,
  rank,
  scopeLabel,
} from '../src/refactoring-intelligence/recommendations/RecommendationBuilder'
import { renderRecommendation } from '../src/refactoring-intelligence/recommendations/RecommendationRenderer'

function candidate(overrides: Partial<Candidate> & { kind: CandidateKind }): Candidate {
  return {
    id: 'c1',
    path: 'app/services/a.rb',
    startLine: 1,
    endLine: 5,
    anchor: 'method',
    className: 'A',
    methodName: 'run',
    headline: 'fixture',
    strength: 'strong',
    severity: 2,
    metrics: {},
    evidence: [{ path: 'app/services/a.rb', startLine: 1, endLine: 5, note: 'fixture' }],
    ...overrides,
  }
}

describe('priority and confidence are derived from measurement', () => {
  it.each([
    [3, 'strong', 'critical'],
    [3, 'moderate', 'high'],
    [2, 'strong', 'high'],
    [2, 'moderate', 'medium'],
    [1, 'strong', 'low'],
    [1, 'weak', 'low'],
  ] as const)('severity %i with a %s rule is %s priority', (severity, strength, expected) => {
    expect(priorityOf(candidate({ kind: 'method.long', severity, strength }))).toBe(expected)
  })

  it('maps rule strength to confidence and ignores how many evidence lines there are', () => {
    const many = candidate({ kind: 'method.long', strength: 'moderate', evidence: [{ path: 'x', startLine: 1, endLine: 1, note: 'a' }, { path: 'x', startLine: 2, endLine: 2, note: 'b' }, { path: 'x', startLine: 3, endLine: 3, note: 'c' }] })
    expect(confidenceOf(many)).toBe('medium')
    expect(confidenceOf(candidate({ kind: 'method.long', strength: 'strong' }))).toBe('high')
    expect(confidenceOf(candidate({ kind: 'method.long', strength: 'weak' }))).toBe('low')
  })
})

describe('scope containment', () => {
  const method: ScopeRef = { kind: 'method', name: 'run', className: 'A', startLine: 3, endLine: 9 }

  it('returns only candidates lying entirely inside the scope', () => {
    const inside = candidate({ kind: 'method.long', startLine: 4, endLine: 8 })
    const overlapping = candidate({ kind: 'class.large', id: 'c2', startLine: 1, endLine: 30, anchor: 'class' })
    const outside = candidate({ kind: 'method.long', id: 'c3', startLine: 20, endLine: 25 })
    expect(candidatesInScope([inside, overlapping, outside], method).map(c => c.id)).toEqual(['c1'])
  })
})

describe('scope labels', () => {
  it('names a method with its class, a class by name, and a block with its enclosing method', () => {
    expect(scopeLabel(candidate({ kind: 'method.long' }))).toBe('A#run')
    expect(scopeLabel(candidate({ kind: 'class.large', anchor: 'class', methodName: undefined }))).toBe('A')
    expect(scopeLabel(candidate({ kind: 'rails.n-plus-one', anchor: 'block', startLine: 3, endLine: 4 }))).toBe('lines 3-4 in A#run')
  })
})

describe('deterministic recommendations', () => {
  it('builds the contract from the best validated technique, with alternatives and verification', () => {
    const rec = buildDeterministicRecommendations([candidate({ kind: 'method.long', metrics: { lines: 20 } })])[0]
    expect(rec).toMatchObject({
      id: 'r1',
      source: 'deterministic',
      candidateIds: ['c1'],
      path: 'app/services/a.rb',
      technique: { id: 'extract-method', name: 'Extract Method' },
      title: 'Extract Method: A#run',
      priority: 'high',
      confidence: 'high',
      affectedFiles: ['app/services/a.rb'],
    })
    expect(rec.design.length).toBeGreaterThan(0)
    expect(rec.verification.length).toBeGreaterThan(0)
    expect(rec.alternatives[rec.alternatives.length - 1].name).toBe('Keep the current code')
  })

  it('produces no recommendation for a candidate that no technique can justify', () => {
    expect(buildDeterministicRecommendations([candidate({ kind: 'method.conditional-chain', metrics: { discriminatorBranches: 3, nonTrivialBranches: 0 } })])).toEqual([])
  })

  it('ranks by priority, then confidence, then position, and assigns ids in that order', () => {
    const low = candidate({ kind: 'method.long', id: 'c1', severity: 1, startLine: 1, metrics: { lines: 16 } })
    const top = candidate({ kind: 'method.long', id: 'c2', severity: 3, strength: 'strong', startLine: 30, endLine: 60, methodName: 'top', metrics: { lines: 40 } })
    const recs = buildDeterministicRecommendations([low, top])
    expect(recs.map(r => [r.id, r.title])).toEqual([['r1', 'Extract Method: A#top'], ['r2', 'Extract Method: A#run']])
  })

  it('caps the number shown, but the uncapped limit returns everything', () => {
    const many = Array.from({ length: ADVISOR_LIMITS.maxDeterministic + 4 }, (_, i) =>
      candidate({ kind: 'method.long', id: `c${i + 1}`, startLine: i * 10 + 1, endLine: i * 10 + 9, methodName: `m${i}`, metrics: { lines: 16 } }))
    expect(buildDeterministicRecommendations(many)).toHaveLength(ADVISOR_LIMITS.maxDeterministic)
    expect(buildDeterministicRecommendations(many, Number.POSITIVE_INFINITY)).toHaveLength(many.length)
  })

  it('removes an exact duplicate (same technique, file and start line)', () => {
    const base: Recommendation = {
      id: '', source: 'deterministic', candidateIds: ['c1'], path: 'a.rb', scope: { kind: 'method', name: 'x', startLine: 2, endLine: 4 },
      title: 't', problem: 'p', evidence: [], confidence: 'high', priority: 'high', technique: { id: 'extract-method', name: 'Extract Method' },
      design: 'd', alternatives: [], benefit: 'b', risk: 'r', affectedFiles: ['a.rb'], steps: [], verification: [],
    }
    expect(rank([base, { ...base, candidateIds: ['c9'] }])).toHaveLength(1)
  })
})

describe('the recommendation document', () => {
  it('renders the contract in order: problem, evidence, design, alternatives, benefit, risk, files, steps, verification', () => {
    const rec = buildDeterministicRecommendations([candidate({ kind: 'method.long', metrics: { lines: 20 } })])[0]
    const text = renderRecommendation(rec)
    const headings = ['## Problem', '## Evidence', '## Recommended design', '## Alternatives', '## Benefit', '## Risk', '## Affected files', '## Steps', '## Verification']
    const positions = headings.map(h => text.indexOf(h))
    expect(positions.every(p => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(text).toContain('rule-based (no AI call)')
    expect(text).toContain('**Priority:** high · **Confidence:** high')
  })

  it('labels AI-refined recommendations as such', () => {
    const rec = { ...buildDeterministicRecommendations([candidate({ kind: 'method.long', metrics: { lines: 20 } })])[0], source: 'ai' as const }
    expect(renderRecommendation(rec)).toContain('AI-refined from measured findings')
  })
})

describe('RefactoringEngine', () => {
  const source = [
    'class Worker',
    ...Array.from({ length: 16 }, (_, i) => [`  def step_${i}`, '    1', '  end']).flat(),
    'end',
    '',
  ].join('\n')

  it('returns the same candidate list for unchanged content, and recomputes when the text changes', () => {
    const engine = new RefactoringEngine(new RubyAstParser())
    const first = engine.candidates('app/services/worker.rb', source)
    expect(engine.candidates('app/services/worker.rb', source)).toBe(first)
    expect(engine.candidates('app/services/worker.rb', source + '\n')).not.toBe(first)
  })

  it('recomputes when the principle findings for the file change', () => {
    let findings: Array<{ id: string; title: string; message: string; line: number; severity: 0 | 1 | 2 | 3 }> = []
    const engine = new RefactoringEngine(new RubyAstParser(), { principleFindings: () => findings })
    const before = engine.candidates('app/services/worker.rb', source)
    findings = [{ id: 'SRP-FAT-CLASS', title: 'Fat class', message: 'm', line: 1, severity: 1 }]
    const after = engine.candidates('app/services/worker.rb', source)
    expect(after).not.toBe(before)
    expect(after.map(c => c.kind)).toContain('principle.srp-fat-class')
  })

  it('lists every class and method as a scope', () => {
    const engine = new RefactoringEngine(new RubyAstParser())
    const scopes = engine.scopes(source)
    expect(scopes[0]).toMatchObject({ kind: 'class', name: 'Worker' })
    expect(scopes.filter(s => s.kind === 'method')).toHaveLength(16)
  })

  it('returns uncapped recommendations for a whole file, for editor grouping', () => {
    // Ten methods that are each long enough to be a recommendation, more than the display cap.
    // Bodies differ by method, so no duplicate-method finding muddies the count.
    const longMethods = ['class Big', ...Array.from({ length: 10 }, (_, i) => [`  def long_${i}`, ...Array.from({ length: 16 }, (_, j) => `    v_${i}_${j} = ${j}`), '  end']).flat(), 'end', ''].join('\n')
    const engine = new RefactoringEngine(new RubyAstParser())
    expect(engine.recommendations('app/services/big.rb', longMethods, { kind: 'class', name: 'Big', startLine: 1, endLine: 180 })).toHaveLength(ADVISOR_LIMITS.maxDeterministic)
    expect(engine.allRecommendations('app/services/big.rb', longMethods)).toHaveLength(10)
  })

  it('reports nothing for a file whose methods are each short and whose class is small', () => {
    const small = ['class Worker', ...Array.from({ length: 5 }, (_, i) => [`  def step_${i}`, '    1', '  end']).flat(), 'end', ''].join('\n')
    const engine = new RefactoringEngine(new RubyAstParser())
    expect(engine.allRecommendations('app/services/worker.rb', small)).toEqual([])
  })

  it('flags a class with sixteen methods as too many, even when each method is trivial', () => {
    const engine = new RefactoringEngine(new RubyAstParser())
    const recs = engine.allRecommendations('app/services/worker.rb', source)
    expect(recs.map(r => r.technique?.id)).toEqual(['extract-class'])
  })
})
