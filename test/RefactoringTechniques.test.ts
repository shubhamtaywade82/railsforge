import { describe, it, expect } from 'vitest'
import { getCatalogPattern } from '../src/patterns/PatternCatalog'
import { TECHNIQUES, techniqueById } from '../src/refactoring-intelligence/patterns/TechniqueCatalog'
import { alternativesFor, selectTechniques } from '../src/refactoring-intelligence/patterns/TechniqueSelector'
import type { Candidate, CandidateKind, CandidateMetrics } from '../src/refactoring-intelligence/core/types'

function candidate(kind: CandidateKind, metrics: CandidateMetrics = {}): Candidate {
  return {
    id: 'c1',
    kind,
    path: 'app/models/order.rb',
    startLine: 1,
    endLine: 10,
    anchor: 'method',
    className: 'Order',
    methodName: 'charge',
    headline: 'fixture',
    strength: 'moderate',
    severity: 2,
    metrics,
    evidence: [],
  }
}

describe('technique catalog integrity', () => {
  it('has unique ids and every technique applies to at least one candidate kind', () => {
    const ids = TECHNIQUES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const technique of TECHNIQUES) {
      expect(technique.appliesTo.length, technique.id).toBeGreaterThan(0)
      expect(technique.whenToUse.length, technique.id).toBeGreaterThan(0)
      expect(technique.avoidWhen.length, technique.id).toBeGreaterThan(0)
    }
  })

  it('links every catalog reference to an entry that exists in the Design Patterns sidebar', () => {
    for (const technique of TECHNIQUES) {
      if (technique.catalogId) {expect(getCatalogPattern(technique.catalogId), technique.id).toBeDefined()}
    }
  })

  it('names only techniques that exist as alternatives', () => {
    for (const technique of TECHNIQUES) {
      for (const alt of technique.alternatives) {expect(techniqueById(alt), `${technique.id} -> ${alt}`).toBeDefined()}
    }
  })
})

describe('Strategy: a conditional is not enough evidence on its own', () => {
  it('rejects a chain with only two branches', () => {
    const selection = selectTechniques(candidate('method.conditional-chain', { discriminatorBranches: 2, nonTrivialBranches: 2 }))
    expect(selection.valid.map(t => t.id)).not.toContain('strategy')
    expect(selection.rejected.find(r => r.technique.id === 'strategy')?.reason).toContain('only 2 branches')
  })

  it('rejects three branches whose bodies are one-line values (a lookup table in disguise)', () => {
    const selection = selectTechniques(candidate('method.conditional-chain', { discriminatorBranches: 3, nonTrivialBranches: 0 }))
    expect(selection.rejected.find(r => r.technique.id === 'strategy')?.reason).toContain('one-line branches')
  })

  it('accepts three branches with real bodies', () => {
    const selection = selectTechniques(candidate('method.conditional-chain', { discriminatorBranches: 3, nonTrivialBranches: 3 }))
    expect(selection.valid.map(t => t.id)).toContain('strategy')
  })
})

describe('other validators', () => {
  it('Service Object needs two collaborators and a persistence or external effect', () => {
    expect(selectTechniques(candidate('rails.controller-workflow', { collaborators: ['A', 'B'], persistenceCalls: 1 })).valid.map(t => t.id)).toContain('service-object')
    expect(selectTechniques(candidate('rails.controller-workflow', { collaborators: ['A'], persistenceCalls: 1 })).valid.map(t => t.id)).not.toContain('service-object')
    expect(selectTechniques(candidate('rails.controller-workflow', { collaborators: ['A', 'B'] })).valid.map(t => t.id)).not.toContain('service-object')
  })

  it('Dependency Injection needs at least two project collaborators created directly', () => {
    expect(selectTechniques(candidate('class.hard-wired-collaborators', { instantiated: ['A'] })).valid).toEqual([])
    expect(selectTechniques(candidate('class.hard-wired-collaborators', { instantiated: ['A', 'B'] })).valid.map(t => t.id)).toEqual(['dependency-injection'])
  })

  it('Domain Event needs two callbacks with side effects; normalising callbacks stay callbacks', () => {
    expect(selectTechniques(candidate('class.callback-heavy', { callbacks: 5, sideEffectCallbacks: 0 })).valid).toEqual([])
    expect(selectTechniques(candidate('class.side-effect-callbacks', { sideEffectCallbacks: 2 })).valid.map(t => t.id)).toEqual(['domain-event'])
  })

  it('Eager Loading needs the N+1 finding itself', () => {
    expect(selectTechniques(candidate('rails.n-plus-one')).valid).toEqual([])
    expect(selectTechniques(candidate('rails.n-plus-one', { nPlusOne: { collection: 'Order.all', variable: 'o', association: 'customer', accessLine: 3 } })).valid.map(t => t.id)).toEqual(['eager-loading'])
  })

  it('Move Method needs exactly one foreign receiver and little use of the own class', () => {
    expect(selectTechniques(candidate('method.feature-envy', { receivers: ['order'], receiverCalls: 4, ownMethodCalls: 0 })).valid.map(t => t.id)).toContain('move-method')
    expect(selectTechniques(candidate('method.feature-envy', { receivers: ['a', 'b'], receiverCalls: 4, ownMethodCalls: 0 })).valid.map(t => t.id)).not.toContain('move-method')
    expect(selectTechniques(candidate('method.feature-envy', { receivers: ['order'], receiverCalls: 4, ownMethodCalls: 3 })).valid.map(t => t.id)).not.toContain('move-method')
  })

  it('Delegate and Remove Unused Code accept only their own principle findings', () => {
    expect(selectTechniques(candidate('principle.demeter', { principleId: 'DEMETER-VIOLATION' })).valid.map(t => t.id)).toEqual(['delegate'])
    expect(selectTechniques(candidate('principle.demeter', { principleId: 'SRP-FAT-CLASS' })).valid).toEqual([])
    expect(selectTechniques(candidate('principle.yagni-unused-private', { principleId: 'YAGNI-UNUSED-PRIVATE' })).valid.map(t => t.id)).toEqual(['remove-unused-code'])
  })

  it('Extract Class accepts an SRP finding from the linter, because the linter has already measured it', () => {
    expect(selectTechniques(candidate('principle.srp-fat-class', { principleId: 'SRP-FAT-CLASS' })).valid.map(t => t.id)).toContain('extract-class')
  })
})

describe('selectTechniques and alternativesFor', () => {
  it('reports each considered technique, with the reason it was rejected', () => {
    const selection = selectTechniques(candidate('method.conditional-chain', { discriminatorBranches: 3, nonTrivialBranches: 1 }))
    expect(selection.valid).toEqual([])
    expect(selection.rejected.map(r => r.technique.id)).toEqual(['strategy'])
  })

  it('lists validated, rejected and declared alternatives, and ends with keeping the current code', () => {
    const service = candidate('rails.controller-workflow', { collaborators: ['A', 'B'], persistenceCalls: 1 })
    const selection = selectTechniques(service)
    const chosen = selection.valid[0]
    const names = alternativesFor(selection, chosen).map(a => a.name)

    expect(chosen.id).toBe('service-object')
    expect(names).toContain('Domain Event')
    expect(names).toContain('Extract Method')
    expect(names[names.length - 1]).toBe('Keep the current code')
    expect(new Set(names).size).toBe(names.length)
  })

  it('marks declared alternatives that were not validated, so nobody mistakes them for evidence-backed options', () => {
    const service = candidate('rails.controller-workflow', { collaborators: ['A', 'B'], persistenceCalls: 1 })
    const selection = selectTechniques(service)
    const domain = alternativesFor(selection, selection.valid[0]).find(a => a.name === 'Domain Event')
    expect(domain?.whenBetter).toContain('Not validated for this code.')
  })
})
