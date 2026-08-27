import { describe, it, expect } from 'vitest'
import { ProjectPatternIndexer } from '../src/patterns/ProjectPatternIndexer'

const createOrderService = `
class CreateOrderService < ApplicationService
  def call
    validate!
    persist!
  end

  private

  def validate!
  end

  def persist!
  end
end
`

const cancelOrderService = `
class CancelOrderService < ApplicationService
  def call
    validate!
    persist!
  end

  private

  def validate!
  end
end
`

const unrelatedPolicy = `
class OrderPolicy < ApplicationPolicy
  def show?
    true
  end
end
`

describe('ProjectPatternIndexer', () => {
  it('classifies files by directory and only indexes recognized pattern directories', () => {
    const indexer = new ProjectPatternIndexer()
    expect(indexer.classifyPath('/repo/app/services/create_order_service.rb')).toBe('service')
    expect(indexer.classifyPath('/repo/app/policies/order_policy.rb')).toBe('policy')
    expect(indexer.classifyPath('/repo/app/models/order.rb')).toBeUndefined()
  })

  it('indexes classes and extracts public methods, ignoring private ones', () => {
    const indexer = new ProjectPatternIndexer()
    indexer.indexFile('/repo/app/services/create_order_service.rb', createOrderService)

    const patterns = indexer.getPatternsByType('service')
    expect(patterns).toHaveLength(1)
    expect(patterns[0].name).toBe('CreateOrderService')
    expect(patterns[0].superclass).toBe('ApplicationService')
    expect(patterns[0].publicMethods).toEqual(['call'])
  })

  it('finds similar patterns of the same type ranked by name and method overlap', () => {
    const indexer = new ProjectPatternIndexer()
    indexer.indexFile('/repo/app/services/create_order_service.rb', createOrderService)
    indexer.indexFile('/repo/app/services/cancel_order_service.rb', cancelOrderService)
    indexer.indexFile('/repo/app/policies/order_policy.rb', unrelatedPolicy)

    const target = indexer.getPatternsByType('service').find(p => p.name === 'CreateOrderService')!
    const similar = indexer.findSimilar(target)

    expect(similar).toHaveLength(1)
    expect(similar[0].name).toBe('CancelOrderService')
  })

  it('removes and re-indexes a file on update', () => {
    const indexer = new ProjectPatternIndexer()
    indexer.indexFile('/repo/app/services/create_order_service.rb', createOrderService)
    indexer.removeFile('/repo/app/services/create_order_service.rb')

    expect(indexer.getAllPatterns()).toHaveLength(0)
  })

  it('finds a pattern at a specific file path and line', () => {
    const indexer = new ProjectPatternIndexer()
    indexer.indexFile('/repo/app/services/create_order_service.rb', createOrderService)

    // Class starts at line 2 in createOrderService
    const found = indexer.findPatternAt('/repo/app/services/create_order_service.rb', 2)
    expect(found?.name).toBe('CreateOrderService')
    expect(indexer.findPatternAt('/repo/app/services/create_order_service.rb', 99)).toBeUndefined()
  })

  it('sorts multiple similar patterns by descending score', () => {
    const indexer = new ProjectPatternIndexer()
    indexer.indexFile('/repo/app/services/create_order_service.rb', createOrderService)
    indexer.indexFile('/repo/app/services/update_order_service.rb', cancelOrderService.replace(/CancelOrderService/g, 'UpdateOrderService'))
    indexer.indexFile('/repo/app/services/send_order_email_service.rb', `
class SendOrderEmailService < ApplicationService
  def call
    validate!
    persist!
  end
end
`)

    const target = indexer.getPatternsByType('service').find(p => p.name === 'CreateOrderService')!
    const similar = indexer.findSimilar(target, 10)
    expect(similar.length).toBeGreaterThan(1)
    // Verify sorted by descending score
    for (let i = 1; i < similar.length; i++) {
      const scoreA = indexer['similarityScore'](target, similar[i - 1])
      const scoreB = indexer['similarityScore'](target, similar[i])
      expect(scoreA).toBeGreaterThanOrEqual(scoreB)
    }
  })

  it('correctly handles do blocks in public method extraction', () => {
    const code = `
class ReportService < ApplicationService
  def call
    items.each do |item|
      process(item)
    end
  end
end
`
    const indexer = new ProjectPatternIndexer()
    indexer.indexFile('/repo/app/services/report_service.rb', code)

    const pattern = indexer.getPatternsByType('service')[0]
    expect(pattern.publicMethods).toContain('call')
  })
})
