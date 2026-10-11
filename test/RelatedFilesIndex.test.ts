import { describe, it, expect } from 'vitest'
import { ProjectPatternIndexer } from '../src/patterns/ProjectPatternIndexer'
import { RelatedFilesIndex } from '../src/graph/RelatedFilesIndex'

const files: Record<string, string> = {
  '/repo/app/services/create_order_service.rb': `
class CreateOrderService < ApplicationService
  def call
    Order.create!(user: @user)
  end
end
`,
  '/repo/app/policies/order_policy.rb': `
class OrderPolicy < ApplicationPolicy
  def show?
    true
  end
end
`,
  '/repo/app/queries/active_users_query.rb': `
class ActiveUsersQuery
  def call
    User.where(active: true)
  end
end
`,
}

function buildIndex(): { indexer: ProjectPatternIndexer; related: RelatedFilesIndex } {
  const indexer = new ProjectPatternIndexer()
  for (const [path, content] of Object.entries(files)) {
    indexer.indexFile(path, content)
  }
  const related = new RelatedFilesIndex(indexer, path => files[path])
  return { indexer, related }
}

describe('RelatedFilesIndex', () => {
  it('finds patterns related to a model by name match', async () => {
    const { related } = buildIndex()
    const relations = await related.getModelRelations('Order')

    expect(relations.patternsByType.policy?.map(p => p.name)).toEqual(['OrderPolicy'])
  })

  it('finds patterns related to a model by ActiveRecord usage in the body', async () => {
    const { related } = buildIndex()
    const relations = await related.getModelRelations('Order')

    expect(relations.patternsByType.service?.map(p => p.name)).toEqual(['CreateOrderService'])
  })

  it('does not relate unrelated patterns', async () => {
    const { related } = buildIndex()
    const relations = await related.getModelRelations('Order')

    expect(relations.patternsByType.query).toBeUndefined()
  })

  it('parses minitest class-based spec file names', () => {
    const { related } = buildIndex()
    related.indexSpecFile('/repo/test/services/create_order_service_test.rb', '  class CreateOrderServiceTest < ActiveSupport::TestCase\n  end\n')

    expect(related.getSpecCount('CreateOrderService')).toBe(1)
  })

  it('returns spec file paths via getSpecFiles', () => {
    const { related } = buildIndex()
    related.indexSpecFile('/repo/spec/a_spec.rb', 'RSpec.describe Order do\nend\n')
    related.indexSpecFile('/repo/spec/b_spec.rb', 'RSpec.describe Order do\nend\n')

    const specFiles = related.getSpecFiles('Order')
    expect(specFiles).toContain('/repo/spec/a_spec.rb')
    expect(specFiles).toContain('/repo/spec/b_spec.rb')
  })

  it('returns false from relatesToModel when readFile throws', async () => {
    const indexer = new ProjectPatternIndexer()
    indexer.indexFile('/repo/app/services/order_service.rb', files['/repo/app/services/create_order_service.rb'])
    const readFile = () => { throw new Error('permission denied') }
    const related = new RelatedFilesIndex(indexer, readFile)

    const relations = await related.getModelRelations('Order')
    // Should not crash, just skip patterns whose files cannot be read
    expect(relations.patternsByType).toBeDefined()
  })

  it('tracks spec counts by described class name', () => {
    const { related } = buildIndex()
    related.indexSpecFile('/repo/spec/services/create_order_service_spec.rb', 'RSpec.describe CreateOrderService do\nend\n')
    related.indexSpecFile('/repo/spec/services/create_order_service_spec2.rb', 'describe CreateOrderService do\nend\n')

    expect(related.getSpecCount('CreateOrderService')).toBe(2)

    related.removeSpecFile('/repo/spec/services/create_order_service_spec.rb')
    expect(related.getSpecCount('CreateOrderService')).toBe(1)
  })

  it('ignores spec files with no recognizable class description', () => {
    const { related } = buildIndex()
    related.indexSpecFile('/repo/spec/no_class_spec.rb', 'RSpec.describe "some string", type: :model do\nend\n')
    expect(related.getSpecCount('Order')).toBe(0)
  })

  it('groups multiple patterns of the same type for one model', async () => {
    const indexer = new ProjectPatternIndexer()
    indexer.indexFile('/repo/app/services/create_order_service.rb', `
class CreateOrderService < ApplicationService
  def call
    Order.create!(user: @user)
  end
end
`)
    indexer.indexFile('/repo/app/services/update_order_service.rb', `
class UpdateOrderService < ApplicationService
  def call
    Order.find(@user).update!(status: 'updated')
  end
end
`)
    const readFile = (p: string) => files[p]
    const related = new RelatedFilesIndex(indexer, readFile)

    const relations = await related.getModelRelations('Order')
    expect(relations.patternsByType.service?.length).toBe(2)
  })
})
