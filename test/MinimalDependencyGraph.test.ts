import { describe, it, expect } from 'vitest'
import { ProjectPatternIndexer } from '../src/patterns/ProjectPatternIndexer'
import { MinimalDependencyGraph } from '../src/graph/MinimalDependencyGraph'

const files: Record<string, string> = {
  '/repo/app/services/create_order_service.rb': `
class CreateOrderService < ApplicationService
  def call
    order = Order.create!
    PaymentGatewayService.call(order: order)
    order
  end
end
`,
  '/repo/app/services/payment_gateway_service.rb': `
class PaymentGatewayService < ApplicationService
  def call
    true
  end
end
`,
  '/repo/app/services/injected_service.rb': `
class InjectedService < ApplicationService
  def initialize(payment_gateway: PaymentGatewayService)
    @payment_gateway = payment_gateway
  end

  def call
    @payment_gateway.call
  end
end
`,
}

async function buildGraph(): Promise<MinimalDependencyGraph> {
  const indexer = new ProjectPatternIndexer()
  for (const [p, content] of Object.entries(files)) {
    indexer.indexFile(p, content)
  }
  const graph = new MinimalDependencyGraph(indexer, path => files[path])
  await graph.rebuild()
  return graph
}

describe('MinimalDependencyGraph', () => {
  it('flags a direct ClassName.call(...) reference as a hard-coded collaborator', async () => {
    const graph = await buildGraph()
    const hardCoded = graph.getHardCodedCollaborators('CreateOrderService')

    expect(hardCoded).toHaveLength(1)
    expect(hardCoded[0].to).toBe('PaymentGatewayService')
  })

  it('does not flag a collaborator that is already constructor-injected', async () => {
    const graph = await buildGraph()
    const hardCoded = graph.getHardCodedCollaborators('InjectedService')

    expect(hardCoded).toHaveLength(0)
  })

  it('tracks callers of a given pattern', async () => {
    const graph = await buildGraph()
    const callers = graph.getCallers('PaymentGatewayService')

    expect(callers.map(c => c.from)).toContain('CreateOrderService')
  })

  it('skips patterns whose files throw on read', async () => {
    const indexer = new ProjectPatternIndexer()
    indexer.indexFile('/repo/app/services/a_service.rb', files['/repo/app/services/create_order_service.rb'])
    const readFile = () => { throw new Error('ENOENT') }
    const graph = new MinimalDependencyGraph(indexer, readFile)
    await graph.rebuild()
    expect(graph.getAllEdges()).toHaveLength(0)
  })

  it('getAllEdges returns all dependency edges', async () => {
    const graph = await buildGraph()
    const edges = graph.getAllEdges()
    expect(edges.length).toBeGreaterThan(0)
    expect(edges[0]).toHaveProperty('from')
    expect(edges[0]).toHaveProperty('to')
    expect(edges[0]).toHaveProperty('hardCoded')
  })
})
