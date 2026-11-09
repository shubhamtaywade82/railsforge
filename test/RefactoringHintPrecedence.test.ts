import { describe, it, expect } from 'vitest'
import { resolveScopeHint } from '../src/refactoring-intelligence/core/HintPrecedence'
import type { ObservedScope } from '../src/refactoring-intelligence/core/ObservationStore'
import type { Recommendation, ScopeRef } from '../src/refactoring-intelligence/core/types'

const SCOPE: ScopeRef = { kind: 'method', name: 'create', className: 'OrdersController', startLine: 2, endLine: 14 }

function rec(id: string, confidence: Recommendation['confidence']): Recommendation {
  return {
    id,
    source: 'ai',
    candidateIds: ['c1'],
    path: 'app/controllers/orders_controller.rb',
    scope: SCOPE,
    title: `hint ${id}`,
    problem: 'p',
    evidence: [],
    confidence,
    priority: 'high',
    technique: null,
    design: 'd',
    alternatives: [],
    benefit: 'b',
    risk: 'r',
    affectedFiles: ['app/controllers/orders_controller.rb'],
    steps: [],
    verification: [],
  }
}

function observation(recommendations: Recommendation[], reasons: string[] = []): ObservedScope {
  return {
    key: 'k',
    path: 'app/controllers/orders_controller.rb',
    scope: SCOPE,
    scopeHash: 'h',
    fingerprint: 'f',
    recommendations,
    reasons,
    observedAt: 0,
  }
}

describe('resolveScopeHint: observed, reviewed, rules, none', () => {
  it('shows the observed AI hints when there are medium or high ones', () => {
    expect(resolveScopeHint(observation([rec('r1', 'high')]), [rec('x', 'medium')])).toEqual({
      kind: 'observed',
      recommendations: [expect.objectContaining({ id: 'r1' })],
    })
  })

  it('lets a rule-based finding show when the AI only produced low-confidence items', () => {
    const hint = resolveScopeHint(observation([rec('low', 'low')]), [rec('rule', 'medium')])
    expect(hint).toEqual({ kind: 'rules', recommendations: [expect.objectContaining({ id: 'rule' })] })
  })

  it('shows nothing when the AI produced only low-confidence items and there are no rules', () => {
    expect(resolveScopeHint(observation([rec('low', 'low')]), [])).toEqual({ kind: 'none' })
  })

  it('reports a review that recommended nothing, with the reasons the AI gave', () => {
    expect(resolveScopeHint(observation([], ['one step only']), [rec('rule', 'high')])).toEqual({
      kind: 'reviewed',
      reasons: ['one step only'],
    })
  })

  it('uses the rule-based findings when the scope was never observed', () => {
    expect(resolveScopeHint(undefined, [rec('rule', 'high'), rec('low', 'low')])).toEqual({
      kind: 'rules',
      recommendations: [expect.objectContaining({ id: 'rule' })],
    })
  })

  it('shows nothing when the scope was never observed and has no rule-based finding', () => {
    expect(resolveScopeHint(undefined, [])).toEqual({ kind: 'none' })
  })
})
