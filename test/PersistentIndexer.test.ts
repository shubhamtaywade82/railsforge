import { describe, it, expect } from 'vitest'
import { openIndexDatabase } from '../src/indexer/database'
import { indexFileIntoDb, removeFileFromDb } from '../src/indexer/PersistentIndexer'
import { RubyAstParser } from '../src/indexer/RubyAstParser'
import { isPersistentIndexSupported } from '../src/indexer/nativeSupport'

const parser = new RubyAstParser()

function freshDb() {
  return openIndexDatabase(':memory:')
}

const createOrderService = `
class CreateOrderService < ApplicationService
  def initialize(user:, payment_gateway: PaymentGateway)
    @user = user
    @payment_gateway = payment_gateway
  end

  def call
    order = Order.create!(user: @user)
    @payment_gateway.charge(order)
    PaymentGatewayService.call(order: order)
    order
  end
end
`

// better-sqlite3's N-API build requires Node >= 22.14 (N-API version 10) — loading it
// on an older runtime aborts the process rather than throwing, so this whole suite is
// skipped there instead of crashing the test run. See src/indexer/database.ts.
describe.skipIf(!isPersistentIndexSupported())('PersistentIndexer', () => {
  it('inserts a symbol row per class with its includes/superclass', () => {
    const db = freshDb()
    indexFileIntoDb(db, '/repo/app/services/create_order_service.rb', createOrderService, parser)

    const row = db.prepare('SELECT * FROM symbols WHERE name = ?').get('CreateOrderService') as { superclass: string }
    expect(row).toBeDefined()
    expect(row.superclass).toBe('ApplicationService')
  })

  it('inserts one row per method with public/private and normalized body', () => {
    const db = freshDb()
    indexFileIntoDb(db, '/repo/app/services/create_order_service.rb', createOrderService, parser)

    const methods = db.prepare('SELECT name, is_public FROM methods ORDER BY start_line').all() as Array<{ name: string; is_public: number }>
    expect(methods.map(m => m.name)).toEqual(['initialize', 'call'])
    expect(methods.every(m => m.is_public === 1)).toBe(true)
  })

  it('records dependency edges, marking constructor-injected collaborators as not hard-coded', () => {
    const db = freshDb()
    indexFileIntoDb(db, '/repo/app/services/create_order_service.rb', createOrderService, parser)

    const deps = db.prepare('SELECT to_name, hard_coded FROM dependencies WHERE from_name = ?').all('CreateOrderService') as Array<{ to_name: string; hard_coded: number }>
    const byName = Object.fromEntries(deps.map(d => [d.to_name, d.hard_coded]))

    expect(byName.PaymentGateway).toBeUndefined() // referenced only as a default param value, not `.call`/`.new`
    expect(byName.Order).toBeUndefined() // Order.create! is an ActiveRecord call, not a collaborator-style .call/.new
    expect(byName.PaymentGatewayService).toBe(1) // hard-coded
  })

  it('skips re-parsing unchanged files (idempotent on identical content)', () => {
    const db = freshDb()
    indexFileIntoDb(db, '/repo/app/services/create_order_service.rb', createOrderService, parser)
    indexFileIntoDb(db, '/repo/app/services/create_order_service.rb', createOrderService, parser)

    const count = db.prepare('SELECT COUNT(*) as c FROM symbols').get() as { c: number }
    expect(count.c).toBe(1)
  })

  it('re-indexes when content changes', () => {
    const db = freshDb()
    indexFileIntoDb(db, '/repo/app/services/create_order_service.rb', createOrderService, parser)
    indexFileIntoDb(db, '/repo/app/services/create_order_service.rb', createOrderService.replace('CreateOrderService', 'RenamedService'), parser)

    const names = (db.prepare('SELECT name FROM symbols').all() as Array<{ name: string }>).map(r => r.name)
    expect(names).toEqual(['RenamedService'])
  })

  it('removes all rows for a file on removeFileFromDb', () => {
    const db = freshDb()
    indexFileIntoDb(db, '/repo/app/services/create_order_service.rb', createOrderService, parser)
    removeFileFromDb(db, '/repo/app/services/create_order_service.rb')

    expect((db.prepare('SELECT COUNT(*) as c FROM symbols').get() as { c: number }).c).toBe(0)
    expect((db.prepare('SELECT COUNT(*) as c FROM methods').get() as { c: number }).c).toBe(0)
    expect((db.prepare('SELECT COUNT(*) as c FROM dependencies').get() as { c: number }).c).toBe(0)
  })

  it('records include dependencies as non-hard-coded edges', () => {
    const db = freshDb()
    indexFileIntoDb(db, '/repo/app/services/order_job.rb', `
class OrderJob
  include Sidekiq::Job
  include Retryable

  def perform
    nil
  end
end
`, parser)

    const deps = db.prepare('SELECT to_name, kind, hard_coded FROM dependencies WHERE from_name = ?').all('OrderJob') as Array<{ to_name: string; kind: string; hard_coded: number }>
    const includeDeps = deps.filter(d => d.kind === 'include')
    expect(includeDeps.map(d => d.to_name)).toContain('Sidekiq::Job')
    expect(includeDeps.map(d => d.to_name)).toContain('Retryable')
    expect(includeDeps.every(d => d.hard_coded === 0)).toBe(true)
  })
})
