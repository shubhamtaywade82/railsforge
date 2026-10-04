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
