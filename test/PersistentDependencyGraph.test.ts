import { describe, it, expect } from 'vitest'
import { openIndexDatabase } from '../src/indexer/database'
import { PersistentDependencyGraph } from '../src/indexer/PersistentDependencyGraph'
import { isPersistentIndexSupported } from '../src/indexer/nativeSupport'

function seedEdges(db: ReturnType<typeof openIndexDatabase>, edges: Array<{ from: string; to: string; hardCoded?: boolean }>) {
  const insert = db.prepare(`
    INSERT INTO dependencies (from_name, to_name, kind, line, hard_coded, file_path)
    VALUES (@from_name, @to_name, 'call', 1, @hard_coded, @file_path)
  `)
  for (const e of edges) {
    insert.run({ from_name: e.from, to_name: e.to, hard_coded: e.hardCoded === false ? 0 : 1, file_path: `/repo/${e.from}.rb` })
  }
}

// See src/indexer/database.ts: better-sqlite3 requires Node >= 22.14, and loading it
// on an older runtime aborts the process rather than throwing a catchable error.
function sqliteBindingsLoadable(): boolean {
  if (!isPersistentIndexSupported()) {return false}
  try {
    openIndexDatabase(':memory:').close()
    return true
  } catch {
    return false
  }
}

describe.skipIf(!sqliteBindingsLoadable())('PersistentDependencyGraph', () => {
  it('returns collaborators and callers for a symbol', () => {
    const db = openIndexDatabase(':memory:')
    seedEdges(db, [{ from: 'CreateOrderService', to: 'PaymentGatewayService' }])
    const graph = new PersistentDependencyGraph(db)

    expect(graph.getCollaborators('CreateOrderService').map(e => e.to)).toEqual(['PaymentGatewayService'])
    expect(graph.getCallers('PaymentGatewayService').map(e => e.from)).toEqual(['CreateOrderService'])
  })

  it('filters hard-coded collaborators', () => {
    const db = openIndexDatabase(':memory:')
    seedEdges(db, [
      { from: 'A', to: 'Injected', hardCoded: false },
      { from: 'A', to: 'HardCoded', hardCoded: true },
    ])
    const graph = new PersistentDependencyGraph(db)

    expect(graph.getHardCodedCollaborators('A').map(e => e.to)).toEqual(['HardCoded'])
  })

  it('finds no cycles in an acyclic graph', () => {
    const db = openIndexDatabase(':memory:')
    seedEdges(db, [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }])
    const graph = new PersistentDependencyGraph(db)

    expect(graph.findCycles()).toEqual([])
  })

  it('detects a direct two-node cycle (A -> B -> A)', () => {
    const db = openIndexDatabase(':memory:')
    seedEdges(db, [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }])
    const graph = new PersistentDependencyGraph(db)

    const cycles = graph.findCycles()
    expect(cycles).toHaveLength(1)
    expect(new Set(cycles[0])).toEqual(new Set(['A', 'B']))
  })

  it('detects a longer cycle (A -> B -> C -> A) and does not duplicate it', () => {
    const db = openIndexDatabase(':memory:')
    seedEdges(db, [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }])
    const graph = new PersistentDependencyGraph(db)

    const cycles = graph.findCycles()
    expect(cycles).toHaveLength(1)
    expect(new Set(cycles[0].slice(0, -1))).toEqual(new Set(['A', 'B', 'C']))
  })
})
