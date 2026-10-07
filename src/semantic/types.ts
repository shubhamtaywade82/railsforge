/**
 * Rails Semantic Graph (RSG) model: entities and typed, evidence-carrying edges describing
 * the *application* (controllers, routes, models, tables, ...), complementing the *language*
 * facts Ruby LSP owns. Pure data — no vscode, no fs.
 */

export type EntityKind =
  | 'model' | 'table' | 'controller' | 'action' | 'route' | 'view' | 'partial'
  | 'service' | 'query' | 'form' | 'policy' | 'decorator' | 'concern'
  | 'job' | 'mailer' | 'migration' | 'spec'

export type EdgeKind =
  | 'routes_to' | 'has_action' | 'renders' | 'maps_to_table' | 'foreign_key'
  | 'belongs_to' | 'has_many' | 'has_one' | 'has_and_belongs_to_many'
  | 'calls' | 'includes' | 'authorizes' | 'tested_by' | 'touches_table' | 'related'

/** Where a fact came from. Higher-ranked sources win when the same fact is reported twice. */
export type FactSource = 'runtime' | 'ast' | 'source' | 'patterns' | 'routes' | 'schema' | 'convention'

export type Confidence = 'runtime' | 'static'

/**
 * How much weight a fact deserves, derived from where it came from:
 *  - verified:  observed in the booted application (runtime snapshot)
 *  - declared:  parsed from an explicit declaration (schema.rb, routes.rb, a real syntax tree)
 *  - extracted: pattern-matched out of Ruby source; can miss metaprogramming and unusual layouts
 *  - inferred:  derived from naming conventions; verify before relying on it
 */
export type ConfidenceClass = 'verified' | 'declared' | 'extracted' | 'inferred'

export function confidenceClass(fact: { source: FactSource; confidence: Confidence }): ConfidenceClass {
  if (fact.confidence === 'runtime' || fact.source === 'runtime') {return 'verified'}
  switch (fact.source) {
    case 'schema': case 'routes': case 'ast': return 'declared'
    case 'source': case 'patterns': return 'extracted'
    case 'convention': return 'inferred'
  }
}

/** What a graph was built from, so staleness can be detected later without rebuilding. */
export interface GraphInput {
  /** Project-relative, forward slashes. */
  path: string
  mtimeMs: number
  size: number
}

export interface GraphProvenance {
  root: string
  /** Epoch ms when the build started. */
  builtAt: number
  inputs: GraphInput[]
  /** Well-known inputs that did not exist at build time (so a later appearance counts as a change). */
  absent: string[]
  /** True when the file cap stopped the scan, i.e. the graph is a partial view. */
  truncated: boolean
  /** The runtime snapshot exists but is older than the schema or a model file. */
  runtimeStale: boolean
  hasRuntimeSnapshot: boolean
}

export const SOURCE_RANK: Record<FactSource, number> = {
  runtime: 6, ast: 5, source: 4, patterns: 3, routes: 3, schema: 3, convention: 1,
}

export type AttrValue = string | number | boolean | string[]

export interface Entity {
  /** `<kind>:<name>`, e.g. `model:User`, `action:OrdersController#index`, `table:orders`. */
  id: string
  kind: EntityKind
  name: string
  file?: string
  /** 1-based. */
  line?: number
  source: FactSource
  confidence: Confidence
  attrs?: Record<string, AttrValue>
}

export interface Edge {
  from: string
  to: string
  kind: EdgeKind
  source: FactSource
  confidence: Confidence
  file?: string
  line?: number
  attrs?: Record<string, AttrValue>
}

export interface FactBatch {
  entities: Entity[]
  edges: Edge[]
}

export const entityId = (kind: EntityKind, name: string): string => `${kind}:${name}`
