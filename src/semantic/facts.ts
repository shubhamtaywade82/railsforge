/**
 * Fact providers: each turns one existing source (schema, routes, patterns, AST rows, runtime
 * snapshot, source files) into a FactBatch. Pure functions over already-read data.
 */

import * as path from 'path'
import { SchemaTable } from '../rails/SchemaIndexer'
import { RailsRoute } from '../rails/RoutesIndexer'
import { IndexedPattern } from '../patterns/ProjectPatternIndexer'
import { RuntimeSnapshot } from '../rails/RuntimeIntrospector'
import { Edge, EdgeKind, Entity, EntityKind, FactBatch, entityId } from './types'
import { camelize, controllerClassFor, singularize, tableNameFor } from './inflect'

const empty = (): FactBatch => ({ entities: [], edges: [] })

export function schemaFacts(tables: readonly SchemaTable[]): FactBatch {
  const batch = empty()
  for (const table of tables) {
    batch.entities.push({
      id: entityId('table', table.name), kind: 'table', name: table.name, file: 'db/schema.rb',
      source: 'schema', confidence: 'static',
      attrs: {
        columns: [...table.columns.values()].map(c => `${c.name}:${c.type}${c.nullable ? '' : '!'}`),
        indexes: table.indexes,
      },
    })
    for (const fk of table.foreignKeys) {
      batch.edges.push({
        from: entityId('table', table.name), to: entityId('table', fk.toTable), kind: 'foreign_key',
        source: 'schema', confidence: 'static', file: 'db/schema.rb', attrs: { column: fk.column },
      })
    }
  }
  return batch
}

export function routesFacts(routes: readonly RailsRoute[]): FactBatch {
  const batch = empty()
  for (const route of routes) {
    if (!route.controller) {continue}
    const controllerName = controllerClassFor(route.controller)
    const controller = entityId('controller', controllerName)
    const action = entityId('action', `${controllerName}#${route.action}`)
    const routeId = entityId('route', `${route.verb || 'ANY'} ${route.uriPattern}`)
    batch.entities.push(
      { id: controller, kind: 'controller', name: controllerName, source: 'routes', confidence: 'static' },
      { id: action, kind: 'action', name: `${controllerName}#${route.action}`, source: 'routes', confidence: 'static' },
      {
        id: routeId, kind: 'route', name: `${route.verb || 'ANY'} ${route.uriPattern}`, file: 'config/routes.rb',
        source: 'routes', confidence: 'static', attrs: route.helperName ? { helper: route.helperName } : undefined,
      },
    )
    batch.edges.push(
      { from: controller, to: action, kind: 'has_action', source: 'routes', confidence: 'static' },
      { from: routeId, to: action, kind: 'routes_to', source: 'routes', confidence: 'static', file: 'config/routes.rb' },
    )
  }
  return batch
}

export function patternFacts(patterns: readonly IndexedPattern[], root?: string): FactBatch {
  const batch = empty()
  for (const p of patterns) {
    batch.entities.push({
      id: entityId(p.type as EntityKind, p.name), kind: p.type as EntityKind, name: p.name,
      file: relativeTo(root, p.filePath), line: p.lineStart, source: 'patterns', confidence: 'static',
      attrs: { publicMethods: p.publicMethods, ...(p.superclass ? { superclass: p.superclass } : {}) },
    })
  }
  return batch
}

export interface DependencyRow {
  from_name: string
  to_name: string
  kind: 'call' | 'include' | string
  line?: number
  file_path?: string
}

/** Edges from the persistent AST index's `dependencies` table; kept only between known classes by the graph. */
export function astFacts(rows: readonly DependencyRow[], resolve: (className: string) => string | undefined, root?: string): FactBatch {
  const batch = empty()
  for (const row of rows) {
    const from = resolve(row.from_name)
    const to = resolve(row.to_name)
    if (!from || !to || from === to) {continue}
    batch.edges.push({
      from, to, kind: row.kind === 'include' ? 'includes' : 'calls', source: 'ast', confidence: 'static',
      file: relativeTo(root, row.file_path), line: row.line,
    })
  }
  return batch
}

const MACRO_TO_EDGE: Record<string, EdgeKind> = {
  belongs_to: 'belongs_to', has_many: 'has_many', has_one: 'has_one', has_and_belongs_to_many: 'has_and_belongs_to_many',
}

export function runtimeFacts(snapshot: RuntimeSnapshot): FactBatch {
  const batch = empty()
  for (const m of snapshot.models) {
    const id = entityId('model', m.name)
    batch.entities.push({
      id, kind: 'model', name: m.name, file: m.file ? relativeTo(undefined, m.file) : undefined,
      source: 'runtime', confidence: 'runtime',
      attrs: {
        validations: m.validations.map(v => `${v.kind}:${v.attributes.join(',')}`),
        callbacks: m.callbacks.map(c => `${c.kind}_${c.event}:${c.filter}`),
      },
    })
    if (m.table) {
      batch.edges.push({ from: id, to: entityId('table', m.table), kind: 'maps_to_table', source: 'runtime', confidence: 'runtime' })
    }
    for (const a of m.associations) {
      const kind = MACRO_TO_EDGE[a.macro]
      if (!kind) {continue}
      const target = a.class_name ?? camelize(singularize(a.name))
      batch.edges.push({
        from: id, to: entityId('model', target), kind, source: 'runtime', confidence: 'runtime',
        attrs: { name: a.name, ...scalarAttrs(a.options) },
      })
    }
  }
  return batch
}

function scalarAttrs(options: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(options)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {out[k] = v}
  }
  return out
}

function relativeTo(root: string | undefined, file: string | undefined): string | undefined {
  if (!file) {return undefined}
  const normalized = file.replace(/\\/g, '/')
  if (root && normalized.startsWith(root.replace(/\\/g, '/'))) {return path.posix.relative(root.replace(/\\/g, '/'), normalized)}
  const appIdx = normalized.search(/(?:^|\/)(app|lib|spec|test|db|config)\//)
  return appIdx >= 0 ? normalized.slice(normalized[appIdx] === '/' ? appIdx + 1 : appIdx) : normalized
}

// ---------------------------------------------------------------------------------------------
// Static source extractors (regex over Ruby source; nothing is executed)
// ---------------------------------------------------------------------------------------------

export interface SourceFile {
  /** Project-relative, forward slashes. */
  path: string
  content: string
}

const lineOf = (content: string, index: number): number => content.slice(0, index).split('\n').length

/** Public instance methods of the first class in `content` (stops at private/protected). */
export function publicMethods(content: string): Array<{ name: string; line: number }> {
  const out: Array<{ name: string; line: number }> = []
  let isPublic = true
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(private|protected)\s*$/.test(line)) {isPublic = false; continue}
    if (/^\s*public\s*$/.test(line)) {isPublic = true; continue}
    const def = /^\s*def\s+([a-z_][A-Za-z0-9_]*[?!]?)\b/.exec(line)
    if (def && isPublic && !/^\s*def\s+self\./.test(line)) {out.push({ name: def[1], line: i + 1 })}
  }
  return out
}

function qualifiedClassName(content: string): { name: string; line: number; superclass?: string } | undefined {
  const modules: string[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const mod = /^\s*module\s+([A-Z][\w:]*)/.exec(lines[i])
    if (mod) {modules.push(mod[1]); continue}
    const cls = /^\s*class\s+([A-Z][\w:]*)(?:\s*<\s*([A-Z][\w:]*))?/.exec(lines[i])
    if (cls) {return { name: [...modules, cls[1]].join('::'), line: i + 1, superclass: cls[2] }}
  }
  return undefined
}

export function controllerFacts(file: SourceFile): FactBatch {
  const batch = empty()
  const cls = qualifiedClassName(file.content)
  if (!cls || !/Controller$/.test(cls.name)) {return batch}
  const controllerId = entityId('controller', cls.name)
  const filters = [...file.content.matchAll(/^\s*(before_action|after_action|around_action|skip_before_action)\s+:(\w+)/gm)].map(m => `${m[1]}:${m[2]}`)
  batch.entities.push({
    id: controllerId, kind: 'controller', name: cls.name, file: file.path, line: cls.line, source: 'source', confidence: 'static',
    attrs: { ...(cls.superclass ? { superclass: cls.superclass } : {}), filters },
  })
  for (const m of publicMethods(file.content)) {
    const actionId = entityId('action', `${cls.name}#${m.name}`)
    batch.entities.push({ id: actionId, kind: 'action', name: `${cls.name}#${m.name}`, file: file.path, line: m.line, source: 'source', confidence: 'static' })
    batch.edges.push({ from: controllerId, to: actionId, kind: 'has_action', source: 'source', confidence: 'static', file: file.path, line: m.line })
  }
  return batch
}

export function modelFacts(file: SourceFile): FactBatch {
  const batch = empty()
  const cls = qualifiedClassName(file.content)
  if (!cls) {return batch}
  const id = entityId('model', cls.name)
  const validations = [...file.content.matchAll(/^\s*validates?\s+((?::\w+,\s*)*:\w+)/gm)].map(m => `validates:${m[1].replace(/[:\s]/g, '')}`)
  const callbacks = [...file.content.matchAll(/^\s*((?:before|after|around)_\w+)\s+:(\w+)/gm)].map(m => `${m[1]}:${m[2]}`)
  const scopes = [...file.content.matchAll(/^\s*scope\s+:(\w+)/gm)].map(m => m[1])
  batch.entities.push({
    id, kind: 'model', name: cls.name, file: file.path, line: cls.line, source: 'source', confidence: 'static',
    attrs: { ...(cls.superclass ? { superclass: cls.superclass } : {}), validations, callbacks, scopes },
  })
  for (const m of file.content.matchAll(/^\s*(belongs_to|has_many|has_one|has_and_belongs_to_many)\s+:(\w+)([^\n]*)/gm)) {
    const [, macro, name, rest] = m
    const explicit = /class_name:\s*["']([\w:]+)["']/.exec(rest)?.[1]
    const target = explicit ?? camelize(singularize(name))
    const through = /through:\s*:(\w+)/.exec(rest)?.[1]
    const dependent = /dependent:\s*:(\w+)/.exec(rest)?.[1]
    const optional = /optional:\s*(true|false)/.exec(rest)?.[1]
    const polymorphic = /polymorphic:\s*true/.test(rest)
    batch.edges.push({
      from: id, to: entityId('model', target), kind: MACRO_TO_EDGE[macro], source: 'source', confidence: 'static',
      file: file.path, line: lineOf(file.content, m.index ?? 0),
      attrs: {
        name,
        ...(through ? { through } : {}),
        ...(dependent ? { dependent } : {}),
        ...(optional ? { optional: optional === 'true' } : {}),
        ...(polymorphic ? { polymorphic: true } : {}),
      },
    })
  }
  return batch
}

/** `app/views/orders/index.html.erb` -> `app/views/orders/index`; `_form.html.erb` -> partial. */
export function viewKeyFor(filePath: string): { key: string; kind: 'view' | 'partial' } {
  const noExt = filePath.replace(/\.[^/]+(\.[^/]+)*$/, '')
  const base = path.posix.basename(noExt)
  return { key: noExt, kind: base.startsWith('_') ? 'partial' : 'view' }
}

export function viewFacts(file: SourceFile): FactBatch {
  const batch = empty()
  const { key, kind } = viewKeyFor(file.path)
  const id = entityId(kind, key)
  batch.entities.push({ id, kind, name: key, file: file.path, source: 'source', confidence: 'static' })
  const dir = path.posix.dirname(key)
  const renders = [
    ...file.content.matchAll(/render\s*\(?\s*(?:partial:\s*)?["']([\w/]+)["']/g),
  ]
  for (const m of renders) {
    const ref = m[1]
    const partialKey = ref.includes('/') ? `app/views/${path.posix.dirname(ref)}/_${path.posix.basename(ref)}` : `${dir}/_${ref}`
    batch.edges.push({
      from: id, to: entityId('partial', partialKey), kind: 'renders', source: 'source', confidence: 'static',
      file: file.path, line: lineOf(file.content, m.index ?? 0),
    })
  }
  return batch
}

export function specFacts(file: SourceFile): FactBatch {
  const batch = empty()
  const id = entityId('spec', file.path)
  batch.entities.push({ id, kind: 'spec', name: file.path, file: file.path, source: 'source', confidence: 'static' })
  const described = /^\s*(?:RSpec\.)?(?:describe|context)\s+([A-Z][\w:]*)/m.exec(file.content)?.[1]
    ?? /^\s*class\s+([A-Z][\w:]*?)Test\b/m.exec(file.content)?.[1]
  if (described) {
    for (const kind of ['model', 'controller', 'service', 'query', 'form', 'policy', 'job', 'mailer'] as const) {
      batch.edges.push({ from: entityId(kind, described), to: id, kind: 'tested_by', source: 'source', confidence: 'static', file: file.path })
    }
  }
  return batch
}

export function migrationFacts(file: SourceFile): FactBatch {
  const batch = empty()
  const id = entityId('migration', file.path)
  const tables = [...new Set([...file.content.matchAll(/\b(?:create_table|add_column|remove_column|change_column|add_index|add_reference|add_foreign_key|drop_table|rename_column|change_table)\s+:?["']?(\w+)/g)].map(m => m[1]))]
  batch.entities.push({ id, kind: 'migration', name: path.posix.basename(file.path, '.rb'), file: file.path, source: 'source', confidence: 'static', attrs: { tables } })
  for (const t of tables) {
    batch.edges.push({ from: id, to: entityId('table', t), kind: 'touches_table', source: 'source', confidence: 'static', file: file.path })
  }
  return batch
}

function classOnlyFacts(file: SourceFile, kind: EntityKind): FactBatch {
  const cls = qualifiedClassName(file.content)
  if (!cls) {return empty()}
  return {
    entities: [{ id: entityId(kind, cls.name), kind, name: cls.name, file: file.path, line: cls.line, source: 'source', confidence: 'static' }],
    edges: [],
  }
}

/** Routes a source file to the right extractor by its conventional location. */
export function sourceFileFacts(file: SourceFile): FactBatch {
  const p = file.path
  if (/^app\/controllers\/.+_controller\.rb$/.test(p)) {return controllerFacts(file)}
  if (/^app\/models\/.+\.rb$/.test(p) && !/^app\/models\/concerns\//.test(p)) {return modelFacts(file)}
  if (/^app\/views\/.+\.(erb|haml|slim|jbuilder)$/.test(p)) {return viewFacts(file)}
  if (/^(spec|test)\/.+_(spec|test)\.rb$/.test(p)) {return specFacts(file)}
  if (/^db\/migrate\/.+\.rb$/.test(p)) {return migrationFacts(file)}
  if (/^app\/jobs\/.+\.rb$/.test(p)) {return classOnlyFacts(file, 'job')}
  if (/^app\/mailers\/.+\.rb$/.test(p)) {return classOnlyFacts(file, 'mailer')}
  return empty()
}

/**
 * Convention links between facts that exist in the graph: model<->table, controller<->model,
 * policy authorizes model, action->view. Only emits an edge when both endpoints exist.
 */
export function conventionEdges(entities: readonly Entity[]): Edge[] {
  const ids = new Set(entities.map(e => e.id))
  const edges: Edge[] = []
  const add = (from: string, to: string, kind: EdgeKind): void => {
    if (ids.has(from) && ids.has(to)) {edges.push({ from, to, kind, source: 'convention', confidence: 'static' })}
  }
  for (const e of entities) {
    if (e.kind === 'model') {
      add(e.id, entityId('table', tableNameFor(e.name)), 'maps_to_table')
    } else if (e.kind === 'controller') {
      const base = e.name.replace(/Controller$/, '')
      add(e.id, entityId('model', singularize(base)), 'related')
      add(entityId('policy', `${singularize(base)}Policy`), entityId('model', singularize(base)), 'authorizes')
    } else if (e.kind === 'action') {
      const [controller, action] = e.name.split('#')
      const dir = controller.replace(/Controller$/, '').split('::').map(s => s.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase()).join('/')
      add(e.id, entityId('view', `app/views/${dir}/${action}`), 'renders')
    } else if (e.kind === 'policy') {
      add(e.id, entityId('model', e.name.replace(/Policy$/, '')), 'authorizes')
    }
  }
  return edges
}
