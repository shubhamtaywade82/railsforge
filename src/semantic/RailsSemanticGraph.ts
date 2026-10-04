/**
 * RailsSemanticGraph - merged entity/edge store with precedence rules and the queries the
 * agent, tools and virtual documents need. Pure and deterministic (stable ordering).
 */

import { Edge, EdgeKind, Entity, EntityKind, FactBatch, SOURCE_RANK } from './types'

export interface NeighborOptions {
  kinds?: readonly EdgeKind[]
  direction?: 'out' | 'in' | 'both'
}

export interface Neighbor {
  edge: Edge
  /** The entity on the other end of the edge. */
  entity: Entity
  direction: 'out' | 'in'
}

const edgeKey = (e: Pick<Edge, 'from' | 'to' | 'kind'>): string => `${e.from}|${e.kind}|${e.to}`
const better = (a: { source: Entity['source']; confidence: Entity['confidence'] }, b: typeof a): boolean =>
  (a.confidence === 'runtime' ? 10 : 0) + SOURCE_RANK[a.source] > (b.confidence === 'runtime' ? 10 : 0) + SOURCE_RANK[b.source]

export class RailsSemanticGraph {
  private readonly entitiesById = new Map<string, Entity>()
  private readonly edgesByKey = new Map<string, Edge>()
  private outIndex = new Map<string, Edge[]>()
  private inIndex = new Map<string, Edge[]>()
  private indexDirty = true

  /** Merges a batch: the higher-ranked source wins scalar fields, attrs are unioned. */
  add(batch: FactBatch): this {
    for (const incoming of batch.entities) {this.mergeEntity(incoming)}
    for (const incoming of batch.edges) {this.mergeEdge(incoming)}
    this.indexDirty = true
    return this
  }

  private mergeEntity(incoming: Entity): void {
    const existing = this.entitiesById.get(incoming.id)
    if (!existing) {
      this.entitiesById.set(incoming.id, { ...incoming, attrs: incoming.attrs ? { ...incoming.attrs } : undefined })
      return
    }
    const winner = better(incoming, existing) ? incoming : existing
    const loser = winner === incoming ? existing : incoming
    this.entitiesById.set(incoming.id, {
      ...loser,
      ...winner,
      file: winner.file ?? loser.file,
      line: winner.line ?? loser.line,
      attrs: { ...loser.attrs, ...winner.attrs },
    })
  }

  private mergeEdge(incoming: Edge): void {
    const key = edgeKey(incoming)
    const existing = this.edgesByKey.get(key)
    if (!existing || better(incoming, existing)) {
      this.edgesByKey.set(key, { ...incoming, file: incoming.file ?? existing?.file, line: incoming.line ?? existing?.line })
    }
  }

  private ensureIndex(): void {
    if (!this.indexDirty) {return}
    this.outIndex = new Map()
    this.inIndex = new Map()
    for (const edge of this.edges()) {
      if (!this.entitiesById.has(edge.from) || !this.entitiesById.has(edge.to)) {continue}
      ;(this.outIndex.get(edge.from) ?? this.outIndex.set(edge.from, []).get(edge.from)!).push(edge)
      ;(this.inIndex.get(edge.to) ?? this.inIndex.set(edge.to, []).get(edge.to)!).push(edge)
    }
    this.indexDirty = false
  }

  entity(id: string): Entity | undefined {
    return this.entitiesById.get(id)
  }

  entities(kind?: EntityKind): Entity[] {
    const all = [...this.entitiesById.values()]
    return (kind ? all.filter(e => e.kind === kind) : all).sort((a, b) => a.id.localeCompare(b.id))
  }

  edges(): Edge[] {
    return [...this.edgesByKey.values()].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)))
  }

  /** Edges touching `id` whose other endpoint exists, in deterministic order. */
  neighbors(id: string, options: NeighborOptions = {}): Neighbor[] {
    this.ensureIndex()
    const direction = options.direction ?? 'both'
    const out: Neighbor[] = []
    const keep = (e: Edge): boolean => !options.kinds || options.kinds.includes(e.kind)
    if (direction !== 'in') {
      for (const edge of this.outIndex.get(id) ?? []) {
        if (keep(edge)) {out.push({ edge, entity: this.entitiesById.get(edge.to)!, direction: 'out' })}
      }
    }
    if (direction !== 'out') {
      for (const edge of this.inIndex.get(id) ?? []) {
        if (keep(edge)) {out.push({ edge, entity: this.entitiesById.get(edge.from)!, direction: 'in' })}
      }
    }
    return out.sort((a, b) => a.entity.id.localeCompare(b.entity.id) || a.edge.kind.localeCompare(b.edge.kind))
  }

  /** Breadth-first neighbourhood (ids, nearest first), capped at `maxNodes`. */
  neighborhood(id: string, depth = 1, maxNodes = 40, kinds?: readonly EdgeKind[]): Entity[] {
    const start = this.entitiesById.get(id)
    if (!start) {return []}
    const seen = new Set([id])
    const result: Entity[] = [start]
    let frontier = [id]
    for (let d = 0; d < depth && result.length < maxNodes; d++) {
      const next: string[] = []
      for (const current of frontier) {
        for (const n of this.neighbors(current, { kinds })) {
          if (seen.has(n.entity.id)) {continue}
          seen.add(n.entity.id)
          result.push(n.entity)
          next.push(n.entity.id)
          if (result.length >= maxNodes) {return result}
        }
      }
      frontier = next
    }
    return result
  }

  /** Entities declared in `filePath` (absolute or project-relative; separators normalised). */
  forFile(filePath: string): Entity[] {
    const target = filePath.replace(/\\/g, '/')
    return this.entities().filter(e => e.file !== undefined && (target === e.file || target.endsWith(`/${e.file}`) || e.file.endsWith(`/${target}`)))
  }

  /** Entities a free-text prompt refers to: class names, `Controller#action`, table names, route paths. */
  linkPrompt(text: string): Entity[] {
    const found = new Map<string, Entity>()
    const tokens = new Set(text.match(/[A-Za-z_][A-Za-z0-9_:]*(?:#[a-z_?!]+)?/g) ?? [])
    const lowered = new Set([...tokens].map(t => t.toLowerCase()))
    for (const entity of this.entitiesById.values()) {
      if (entity.kind === 'route' || entity.kind === 'spec' || entity.kind === 'migration' || entity.kind === 'view' || entity.kind === 'partial') {continue}
      const name = entity.name
      const hit = tokens.has(name)
        || (entity.kind === 'table' && lowered.has(name.toLowerCase()))
      if (hit) {found.set(entity.id, entity)}
    }
    // "orders#index" / "OrdersController#index" shorthands
    for (const m of text.matchAll(/\b([a-z_/]+)#([a-z_?!]+)\b/g)) {
      const controller = m[1].split('/').map(p => p.split('_').map(s => s[0]?.toUpperCase() + s.slice(1)).join('')).join('::')
      const action = this.entitiesById.get(`action:${controller}Controller#${m[2]}`)
      if (action) {found.set(action.id, action)}
    }
    return [...found.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  stats(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const e of this.entitiesById.values()) {counts[e.kind] = (counts[e.kind] ?? 0) + 1}
    counts.edges = this.edgesByKey.size
    return counts
  }
}
