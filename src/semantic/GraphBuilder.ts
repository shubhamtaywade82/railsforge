/**
 * GraphBuilder - reads a project from disk and assembles its RailsSemanticGraph.
 * vscode-free (used by the MCP server, the LM tools and the extension). Never executes
 * application code; the runtime snapshot is read only if the developer already created it.
 */

import * as fs from 'fs'
import * as path from 'path'
import { SchemaIndexer } from '../rails/SchemaIndexer'
import { RoutesIndexer } from '../rails/RoutesIndexer'
import { ProjectPatternIndexer } from '../patterns/ProjectPatternIndexer'
import { RuntimeSnapshot } from '../rails/RuntimeIntrospector'
import { RailsSemanticGraph } from './RailsSemanticGraph'
import { DependencyRow, SourceFile, astFacts, conventionEdges, patternFacts, routesFacts, runtimeFacts, schemaFacts, sourceFileFacts } from './facts'

const SCAN_DIRS = ['app', 'spec', 'test', 'db/migrate', 'lib']
const SOURCE_EXT = /\.(rb|erb|haml|slim|jbuilder)$/
const DEFAULT_EXCLUDED = new Set(['node_modules', 'vendor', 'tmp', 'log', '.git', 'coverage', 'public', 'storage'])
const MAX_FILE_BYTES = 400_000

export interface BuildOptions {
  excludedDirNames?: ReadonlySet<string>
  maxFiles?: number
  /** Rows from the persistent AST index's `dependencies` table, if available. */
  dependencyRows?: readonly DependencyRow[]
  /** Overrides reading `.railsforge/runtime.json`. */
  runtimeSnapshot?: RuntimeSnapshot | null
}

function readIfExists(file: string): string | undefined {
  try { return fs.readFileSync(file, 'utf8') } catch { return undefined }
}

export function collectSourceFiles(root: string, excluded: ReadonlySet<string>, maxFiles: number): SourceFile[] {
  const files: SourceFile[] = []
  const walk = (dir: string): void => {
    if (files.length >= maxFiles) {return}
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= maxFiles) {return}
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) {walk(full)}
      } else if (SOURCE_EXT.test(entry.name)) {
        try {
          if (fs.statSync(full).size > MAX_FILE_BYTES) {continue}
          files.push({ path: path.relative(root, full).split(path.sep).join('/'), content: fs.readFileSync(full, 'utf8') })
        } catch { /* unreadable: skip */ }
      }
    }
  }
  for (const dir of SCAN_DIRS) {walk(path.join(root, dir))}
  return files
}

export function loadRuntimeSnapshot(root: string): RuntimeSnapshot | undefined {
  const text = readIfExists(path.join(root, '.railsforge', 'runtime.json'))
  if (!text) {return undefined}
  try {
    const parsed = JSON.parse(text) as RuntimeSnapshot
    return Array.isArray(parsed.models) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function buildSemanticGraph(root: string, options: BuildOptions = {}): RailsSemanticGraph {
  const graph = new RailsSemanticGraph()
  const excluded = options.excludedDirNames ?? DEFAULT_EXCLUDED

  const schema = new SchemaIndexer()
  const schemaText = readIfExists(path.join(root, 'db', 'schema.rb'))
  if (schemaText) {schema.parseSchema(schemaText)}
  graph.add(schemaFacts(schema.getAllTables()))

  const routes = new RoutesIndexer()
  const routesText = readIfExists(path.join(root, 'config', 'routes.rb'))
  if (routesText) {routes.parseRoutesDsl(routesText)}
  graph.add(routesFacts(routes.getAllRoutes()))

  const files = collectSourceFiles(root, excluded, options.maxFiles ?? 6000)
  const patterns = new ProjectPatternIndexer()
  for (const file of files) {
    graph.add(sourceFileFacts(file))
    if (file.path.endsWith('.rb') && /^(app|lib)\//.test(file.path)) {
      try { patterns.indexFile(path.join(root, file.path), file.content) } catch { /* skip */ }
    }
  }
  graph.add(patternFacts(patterns.getAllPatterns(), root))

  const snapshot = options.runtimeSnapshot === undefined ? loadRuntimeSnapshot(root) : options.runtimeSnapshot
  if (snapshot) {graph.add(runtimeFacts(snapshot))}

  const byName = new Map<string, string>()
  for (const e of graph.entities()) {
    if (e.kind !== 'action' && e.kind !== 'route' && e.kind !== 'table' && !byName.has(e.name)) {byName.set(e.name, e.id)}
  }
  if (options.dependencyRows) {graph.add(astFacts(options.dependencyRows, name => byName.get(name), root))}

  graph.add({ entities: [], edges: conventionEdges(graph.entities()) })
  return graph
}
