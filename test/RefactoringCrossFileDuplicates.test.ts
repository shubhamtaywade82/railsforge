import { describe, it, expect } from 'vitest'
import { RubyAstParser } from '../src/indexer/RubyAstParser'
import { collectCandidates } from '../src/refactoring-intelligence/analyzers/CandidateCollector'
import { STRONG_CROSS_FILE_SIMILARITY } from '../src/refactoring-intelligence/analyzers/CrossFileDuplicationAnalyzer'
import type { CrossFileDuplicate } from '../src/refactoring-intelligence/core/CrossFileDuplicates'
import { RefactoringEngine } from '../src/refactoring-intelligence/core/RefactoringEngine'
import { ADVISOR_LIMITS } from '../src/refactoring-intelligence/core/types'
import type { Candidate, ScopeRef } from '../src/refactoring-intelligence/core/types'
import { selectTechniques } from '../src/refactoring-intelligence/patterns/TechniqueSelector'
import { affectedFilesOf, buildDeterministicRecommendations } from '../src/refactoring-intelligence/recommendations/RecommendationBuilder'

const parser = new RubyAstParser()
const PATH = 'app/controllers/orders_controller.rb'
const PARTNER = 'app/services/checkout_service.rb'

// `create` spans lines 2 to 8; the class closes on line 9.
const CONTROLLER = `class OrdersController < ApplicationController
  def create
    order = Order.new(order_params)
    order.total = order.items.sum(&:price)
    order.save!
    PaymentGateway.charge(order)
    OrderMailer.confirm(order).deliver_later
  end
end
`

function copyOf(overrides: Partial<CrossFileDuplicate> = {}): CrossFileDuplicate {
  return {
    lineStart: 2,
    lineEnd: 8,
    methodName: 'create',
    otherPath: PARTNER,
    otherLineStart: 4,
    otherLineEnd: 9,
    otherMethodName: 'call',
    similarity: 0.94,
    ...overrides,
  }
}

function crossFileCandidates(duplicates: CrossFileDuplicate[], content = CONTROLLER): Candidate[] {
  return collectCandidates(parser, { path: PATH, content, crossFileDuplicates: duplicates }).filter(c => c.kind === 'duplicate.cross-file')
}

describe('cross-file duplicate candidates', () => {
  it('raises one strong candidate for a method the index found in another file', () => {
    const [candidate] = crossFileCandidates([copyOf()])

    expect(candidate).toMatchObject({
      kind: 'duplicate.cross-file',
      startLine: 2,
      endLine: 8,
      anchor: 'method',
      className: 'OrdersController',
      methodName: 'create',
      strength: 'strong',
      severity: 2,
    })
    expect(candidate.metrics.partnerPaths).toEqual([PARTNER])
    expect(candidate.evidence.map(e => e.path)).toEqual([PATH, PARTNER])
  })

  it('treats 0.9 as strong and anything below it as moderate', () => {
    expect(STRONG_CROSS_FILE_SIMILARITY).toBe(0.9)
    const [atBoundary] = crossFileCandidates([copyOf({ similarity: 0.9 })])
    const [below] = crossFileCandidates([copyOf({ similarity: 0.8 })])

    expect(atBoundary.strength).toBe('strong')
    expect(below.strength).toBe('moderate')
  })

  it('merges every partner of one method into a single candidate', () => {
    const candidates = crossFileCandidates([
      copyOf(),
      copyOf({ otherPath: 'app/services/refund_service.rb', otherMethodName: 'perform', similarity: 0.8 }),
    ])

    expect(candidates).toHaveLength(1)
    expect(candidates[0].metrics.partnerPaths).toEqual([PARTNER, 'app/services/refund_service.rb'])
    expect(candidates[0].headline).toContain('2 other files')
    expect(candidates[0].strength).toBe('strong')
    expect(candidates[0].evidence).toHaveLength(3)
  })

  it('raises nothing when the index entry no longer matches the file', () => {
    // Wrong start line: the method is not there any more.
    expect(crossFileCandidates([copyOf({ lineStart: 3, lineEnd: 8 })])).toEqual([])
    // Right lines, wrong name: the method was renamed since the last save.
    expect(crossFileCandidates([copyOf({ methodName: 'store' })])).toEqual([])
  })

  it('raises nothing without index facts', () => {
    expect(crossFileCandidates([])).toEqual([])
  })
})

describe('shared collaborator technique and affected files', () => {
  it('applies only when a partner file exists', () => {
    const [withPartner] = crossFileCandidates([copyOf()])
    const withoutPartner: Candidate = { ...withPartner, metrics: { ...withPartner.metrics, partnerPaths: [] } }

    expect(selectTechniques(withPartner).valid.map(t => t.id)).toContain('extract-shared-collaborator')
    expect(selectTechniques(withoutPartner).valid.map(t => t.id)).not.toContain('extract-shared-collaborator')
  })

  it('produces a recommendation that names every affected file', () => {
    const candidates = crossFileCandidates([copyOf()])
    const recommendation = buildDeterministicRecommendations(candidates).find(r => r.technique?.id === 'extract-shared-collaborator')

    expect(recommendation).toBeDefined()
    expect(recommendation?.affectedFiles).toEqual([PATH, PARTNER])
    expect(recommendation?.priority).toBe('high')
    expect(recommendation?.confidence).toBe('high')
    expect(recommendation?.design).toContain(PARTNER)
  })

  it('caps affected files at the advisor limit and removes repeats', () => {
    const many = Array.from({ length: 10 }, (_, i) => `app/services/partner_${i}.rb`)
    const [candidate] = crossFileCandidates(many.map((p, i) => copyOf({ otherPath: p, otherMethodName: `call_${i}` })))
    const files = affectedFilesOf({ ...candidate, metrics: { ...candidate.metrics, partnerPaths: [PATH, ...many] } })

    expect(files).toHaveLength(ADVISOR_LIMITS.maxFilesPerRecommendation)
    expect(new Set(files).size).toBe(files.length)
    expect(files[0]).toBe(PATH)
  })
})

describe('engine cache and cross-file facts', () => {
  const scope: ScopeRef = { kind: 'method', name: 'create', className: 'OrdersController', startLine: 2, endLine: 8 }

  it('reflects a change in the index facts without a change to the file', () => {
    let duplicates: CrossFileDuplicate[] = [copyOf()]
    const engine = new RefactoringEngine(parser, { crossFileDuplicates: () => duplicates })

    const before = engine.recommendations(PATH, CONTROLLER, scope).map(r => r.technique?.id)
    duplicates = []
    const after = engine.recommendations(PATH, CONTROLLER, scope).map(r => r.technique?.id)

    expect(before).toContain('extract-shared-collaborator')
    expect(after).not.toContain('extract-shared-collaborator')
  })
})
