/**
 * RailsContextBuilder - renders a budgeted, deterministic markdown description of the part of the
 * Rails application a request is about (seeded by the open file and entities named in the prompt).
 */

import { RailsSemanticGraph, Neighbor } from './RailsSemanticGraph'
import { ConfidenceClass, Edge, Entity, GraphProvenance, confidenceClass } from './types'

export interface ContextRequest {
  /** Project-relative or absolute path of the active file. */
  filePath?: string
  prompt?: string
  /** Explicit entity ids (e.g. `model:Order`). */
  seeds?: readonly string[]
  maxChars?: number
  maxSeeds?: number
}

const KIND_PRIORITY: Record<string, number> = { action: 0, controller: 1, model: 2, service: 3, query: 3, form: 3, policy: 3, job: 3, mailer: 3, decorator: 4, concern: 4, table: 5, view: 6, partial: 6, spec: 7, migration: 8, route: 9 }

export function selectSeeds(graph: RailsSemanticGraph, request: ContextRequest): Entity[] {
  const seeds = new Map<string, Entity>()
  for (const id of request.seeds ?? []) {
    const e = graph.entity(id)
    if (e) {seeds.set(e.id, e)}
  }
  if (request.filePath) {
    for (const e of graph.forFile(request.filePath)) {
      // An action line inside a file is noise when its controller is present.
      if (e.kind !== 'action') {seeds.set(e.id, e)}
    }
  }
  if (request.prompt) {
    for (const e of graph.linkPrompt(request.prompt)) {seeds.set(e.id, e)}
  }
  return [...seeds.values()]
    .sort((a, b) => (KIND_PRIORITY[a.kind] ?? 9) - (KIND_PRIORITY[b.kind] ?? 9) || a.id.localeCompare(b.id))
    .slice(0, request.maxSeeds ?? 4)
}

/** Marker for facts a reader should weigh: everything except `declared` (the unremarkable default). */
function tag(fact: { source: Entity['source']; confidence: Entity['confidence'] }, used: Set<ConfidenceClass>): string {
  const cls = confidenceClass(fact)
  if (cls === 'declared') {return ''}
  used.add(cls)
  return ` [${cls}]`
}

const LEGEND: Record<ConfidenceClass, string> = {
  verified: 'verified = observed in the booted app',
  declared: 'declared = parsed from schema/routes',
  extracted: 'extracted = pattern-matched from source, may miss metaprogramming',
  inferred: 'inferred = naming convention, verify before relying on it',
}

const attrList = (e: Entity, key: string): string[] => {
  const v = e.attrs?.[key]
  return Array.isArray(v) ? v : []
}

const loc = (e: { file?: string; line?: number }): string => (e.file ? ` (${e.file}${e.line ? `:${e.line}` : ''})` : '')
const edgeNote = (edge: Edge): string => {
  const a = edge.attrs ?? {}
  const parts = ['through', 'dependent', 'polymorphic', 'optional'].filter(k => a[k] !== undefined).map(k => `${k}: ${String(a[k])}`)
  return parts.length ? ` [${parts.join(', ')}]` : ''
}

function renderController(graph: RailsSemanticGraph, e: Entity, used: Set<ConfidenceClass>): string[] {
  const lines = [`### ${e.name} — controller${loc(e)}${tag(e, used)}`]
  const filters = attrList(e, 'filters')
  if (filters.length) {lines.push(`- filters: ${filters.join(', ')}`)}
  for (const n of graph.neighbors(e.id, { kinds: ['has_action'], direction: 'out' })) {
    const routes = graph.neighbors(n.entity.id, { kinds: ['routes_to'], direction: 'in' }).map(r => r.entity.name)
    const views = graph.neighbors(n.entity.id, { kinds: ['renders'], direction: 'out' }).map(r => r.entity.name)
    lines.push(`- ${n.entity.name.split('#')[1]}${routes.length ? ` ← ${routes.join(', ')}` : ''}${views.length ? ` → view ${views.join(', ')}` : ''}${loc(n.entity)}${tag(n.entity, used)}`)
  }
  for (const n of graph.neighbors(e.id, { kinds: ['related'], direction: 'out' })) {lines.push(`- resource model: ${n.entity.name}${loc(n.entity)}${tag(n.edge, used)}`)}
  return lines
}

function renderModel(graph: RailsSemanticGraph, e: Entity, used: Set<ConfidenceClass>): string[] {
  const lines = [`### ${e.name} — model${loc(e)}${tag(e, used)}`]
  const table = graph.neighbors(e.id, { kinds: ['maps_to_table'], direction: 'out' })[0]
  if (table) {
    const cols = attrList(table.entity, 'columns')
    lines.push(`- table \`${table.entity.name}\`${tag(table.edge, used)}: ${cols.join(', ')}`)
    const idx = attrList(table.entity, 'indexes')
    if (idx.length) {lines.push(`- indexes: ${idx.join('; ')}`)}
    for (const fk of graph.neighbors(table.entity.id, { kinds: ['foreign_key'], direction: 'out' })) {
      lines.push(`- foreign key ${String(fk.edge.attrs?.column ?? '?')} → ${fk.entity.name}${tag(fk.edge, used)}`)
    }
  }
  const assoc = graph.neighbors(e.id, { kinds: ['belongs_to', 'has_many', 'has_one', 'has_and_belongs_to_many'], direction: 'out' })
  for (const n of assoc) {lines.push(`- ${n.edge.kind} :${String(n.edge.attrs?.name ?? n.entity.name)} → ${n.entity.name}${edgeNote(n.edge)}${tag(n.edge, used)}`)}
  const validations = attrList(e, 'validations')
  if (validations.length) {lines.push(`- validations${tag(e, used)}: ${validations.join('; ')}`)}
  const callbacks = attrList(e, 'callbacks')
  if (callbacks.length) {lines.push(`- callbacks${tag(e, used)}: ${callbacks.join('; ')}`)}
  const scopes = attrList(e, 'scopes')
  if (scopes.length) {lines.push(`- scopes${tag(e, used)}: ${scopes.join(', ')}`)}
  appendRelated(graph, e, lines, used)
  return lines
}

function appendRelated(graph: RailsSemanticGraph, e: Entity, lines: string[], used: Set<ConfidenceClass>): void {
  const groups = new Map<string, string[]>()
  const push = (label: string, n: Neighbor): void => {
    const list = groups.get(label) ?? []
    list.push(`${n.entity.name}${loc(n.entity)}${tag(n.edge, used)}`)
    groups.set(label, list)
  }
  for (const n of graph.neighbors(e.id)) {
    const k = n.edge.kind
    if (k === 'tested_by') {push('specs', n)}
    else if (k === 'authorizes' && n.direction === 'in') {push('policy', n)}
    else if (k === 'related' && n.direction === 'in') {push('controllers', n)}
    else if ((k === 'calls' || k === 'includes') && n.direction === 'in') {push('used by', n)}
    else if ((k === 'calls' || k === 'includes') && n.direction === 'out') {push('depends on', n)}
    else if (k === 'touches_table' && n.direction === 'in') {push('migrations', n)}
  }
  for (const [label, items] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${label}: ${[...new Set(items)].slice(0, 6).join('; ')}`)
  }
}

function renderGeneric(graph: RailsSemanticGraph, e: Entity, used: Set<ConfidenceClass>): string[] {
  const lines = [`### ${e.name} — ${e.kind}${loc(e)}${tag(e, used)}`]
  const methods = attrList(e, 'publicMethods')
  if (methods.length) {lines.push(`- public methods: ${methods.slice(0, 12).join(', ')}`)}
  appendRelated(graph, e, lines, used)
  return lines
}

/** "Graph built 2026-10-07T03:00:00.000Z from 120 files; runtime snapshot: present (older than schema/models — may be stale)". */
export function describeProvenance(p: GraphProvenance): string {
  const runtime = !p.hasRuntimeSnapshot ? 'absent' : p.runtimeStale ? 'present but older than the schema/models, may be stale' : 'present'
  const files = p.inputs.filter(i => !['db/schema.rb', 'config/routes.rb', '.railsforge/runtime.json'].includes(i.path)).length
  return `Graph built ${new Date(p.builtAt).toISOString()} from ${files} source files${p.truncated ? ' (file cap reached: partial view)' : ''}; runtime snapshot: ${runtime}.`
}

export function buildSemanticContext(graph: RailsSemanticGraph, request: ContextRequest): string {
  const seeds = selectSeeds(graph, request)
  if (seeds.length === 0) {return ''}
  const budget = request.maxChars ?? 4000
  const blocks: string[] = []
  const used = new Set<ConfidenceClass>()
  let usedChars = 0
  for (const e of seeds) {
    const lines = e.kind === 'controller' ? renderController(graph, e, used) : e.kind === 'model' ? renderModel(graph, e, used) : renderGeneric(graph, e, used)
    const block = lines.join('\n')
    if (usedChars + block.length > budget && blocks.length > 0) {break}
    blocks.push(block.length > budget ? `${block.slice(0, budget)}\n…[truncated]` : block)
    usedChars += block.length
  }
  const footer: string[] = []
  if (used.size > 0) {
    footer.push(`_Fact confidence — ${(['verified', 'extracted', 'inferred'] as ConfidenceClass[]).filter(c => used.has(c)).map(c => LEGEND[c]).join('; ')}. Untagged facts are declared (schema/routes)._`)
  }
  if (graph.provenance) {footer.push(`_${describeProvenance(graph.provenance)}_`)}
  return `## Rails application facts (from the project's semantic graph)\n\n${blocks.join('\n\n')}${footer.length ? `\n\n${footer.join('\n')}` : ''}`
}

/** Compact overview for virtual documents: counts plus controller→route and model→association maps. */
export function renderGraphOverview(graph: RailsSemanticGraph): string {
  const stats = graph.stats()
  const out = ['# Rails Semantic Graph', '', Object.entries(stats).sort().map(([k, v]) => `${k}: ${v}`).join(' · '), '']
  if (graph.provenance) {out.push(`_${describeProvenance(graph.provenance)}_`, '')}
  out.push('## Controllers')
  for (const c of graph.entities('controller')) {
    const actions = graph.neighbors(c.id, { kinds: ['has_action'], direction: 'out' }).map(n => n.entity.name.split('#')[1])
    out.push(`- **${c.name}**${loc(c)}: ${actions.join(', ') || '(no actions)'}`)
  }
  out.push('', '## Models')
  for (const m of graph.entities('model')) {
    const assoc = graph.neighbors(m.id, { kinds: ['belongs_to', 'has_many', 'has_one', 'has_and_belongs_to_many'], direction: 'out' }).map(n => `${n.edge.kind} ${n.entity.name}`)
    out.push(`- **${m.name}**${loc(m)}${assoc.length ? `: ${assoc.join(', ')}` : ''}`)
  }
  return `${out.join('\n')}\n`
}
