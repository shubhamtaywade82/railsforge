import * as path from 'path'
import { describe, it, expect } from 'vitest'
import { specFilePathFor, buildRspecSkeleton } from '../src/refactor/SpecFileGenerator'

const native = (p: string) => p.split('/').join(path.sep)

describe('SpecFileGenerator', () => {
  it('builds the spec path from the service file path convention', () => {
    const specPath = specFilePathFor('/repo/app/services/create_order_service.rb', '/repo', 'service')
    expect(specPath).toBe(native('/repo/spec/services/create_order_service_spec.rb'))
  })

  it('builds the spec path for queries under spec/queries', () => {
    const specPath = specFilePathFor('/repo/app/queries/active_users_query.rb', '/repo', 'query')
    expect(specPath).toBe(native('/repo/spec/queries/active_users_query_spec.rb'))
  })

  it('generates an RSpec skeleton referencing the class and .call for a service', () => {
    const skeleton = buildRspecSkeleton('CreateOrderService', 'service', 'call')
    expect(skeleton).toContain('RSpec.describe CreateOrderService do')
    expect(skeleton).toContain("describe '.call'")
    expect(skeleton).toContain('pending')
  })
})
