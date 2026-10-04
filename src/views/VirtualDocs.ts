/**
 * VirtualDocs - pure markdown renderers for the read-only `railsforge:` virtual documents
 * (routes, schema, runtime, toolchain). No vscode dependency, so each is unit-tested.
 */

import { RailsRoute } from '../rails/RoutesIndexer'
import { SchemaTable } from '../rails/SchemaIndexer'
import { RuntimeSnapshot, formatSnapshotMarkdown } from '../rails/RuntimeIntrospector'

export type VirtualDocKind = 'routes' | 'schema' | 'runtime' | 'toolchain' | 'graph'
export const VIRTUAL_DOC_KINDS: readonly VirtualDocKind[] = ['routes', 'schema', 'runtime', 'toolchain', 'graph']
export const VIRTUAL_DOC_SCHEME = 'railsforge'

export function renderRoutesDoc(routes: readonly RailsRoute[]): string {
  if (routes.length === 0) {return '# Routes\n\n_No routes indexed (config/routes.rb missing or empty)._\n'}
  const rows = routes.map(r => `| ${r.verb || 'ANY'} | \`${r.uriPattern}\` | ${r.controller}#${r.action} | ${r.helperName ? `\`${r.helperName}\`` : ''} |`)
  return ['# Routes', '', `${routes.length} routes (static parse of config/routes.rb)`, '', '| Verb | Path | Action | Helper |', '| --- | --- | --- | --- |', ...rows, ''].join('\n')
}

export function renderSchemaDoc(tables: readonly SchemaTable[]): string {
  if (tables.length === 0) {return '# Schema\n\n_No tables indexed (db/schema.rb missing or empty)._\n'}
  const out = ['# Schema', '', `${tables.length} tables (db/schema.rb)`]
  for (const table of [...tables].sort((a, b) => a.name.localeCompare(b.name))) {
    out.push('', `## ${table.name}`, '', '| Column | Type | Null |', '| --- | --- | --- |')
    for (const col of table.columns.values()) {out.push(`| ${col.name} | ${col.type} | ${col.nullable ? 'yes' : 'NOT NULL'} |`)}
    if (table.indexes.length > 0) {out.push('', `Indexes: ${table.indexes.join(', ')}`)}
    if (table.foreignKeys.length > 0) {out.push('', `Foreign keys: ${table.foreignKeys.map(f => `${f.column} → ${f.toTable}`).join(', ')}`)}
  }
  return `${out.join('\n')}\n`
}

export function renderRuntimeDoc(snapshot: RuntimeSnapshot | undefined): string {
  return snapshot
    ? formatSnapshotMarkdown(snapshot)
    : '# Rails runtime introspection\n\n_No snapshot yet. Run **RailsForge: Refresh Rails Runtime Introspection** (it boots your app, so it is opt-in)._\n'
}

export interface ToolchainInfo {
  root: string
  rubyVersion: string
  railsVersion: string
  versionManager: string
  launcher: string
  testFramework: string
  projectType: string
}

export function renderToolchainDoc(info: ToolchainInfo): string {
  return [
    '# Toolchain', '',
    `- Project: \`${info.root}\``,
    `- Type: ${info.projectType}`,
    `- Ruby: ${info.rubyVersion}`,
    `- Rails: ${info.railsVersion || 'not a Rails app'}`,
    `- Version manager: ${info.versionManager}`,
    `- Tool launcher: ${info.launcher}`,
    `- Test framework: ${info.testFramework}`,
    '',
  ].join('\n')
}

/** `railsforge:/routes.md?root=<encoded>` — the root travels in the query so the path stays a clean file name. */
export function virtualDocPath(kind: VirtualDocKind): string {
  return `/${kind}.md`
}

export function parseVirtualDocKind(uriPath: string): VirtualDocKind | undefined {
  const m = /^\/(routes|schema|runtime|toolchain|graph)\.md$/.exec(uriPath)
  return m ? (m[1] as VirtualDocKind) : undefined
}
