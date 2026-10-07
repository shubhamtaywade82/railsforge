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
import { GraphInput, GraphProvenance } from './types'
import { DependencyRow, SourceFile, astFacts, conventionEdges, patternFacts, routesFacts, runtimeFacts, schemaFacts, sourceFileFacts } from './facts'

const SCAN_DIRS = ['app', 'spec', 'test', 'db/migrate', 'lib']
const SOURCE_EXT = /\.(rb|erb|haml|slim|jbuilder)$/
const DEFAULT_EXCLUDED = new Set(['node_modules', 'vendor', 'tmp', 'log', '.git', 'coverage', 'public', 'storage'])
const MAX_FILE_BYTES = 400_000

/** Single files that feed the graph besides the scanned tree. */
export const WELL_KNOWN_INPUTS = ['db/schema.rb', 'config/routes.rb', '.railsforge/runtime.json'] as const

export interface BuildOptions {
  excludedDirNames?: ReadonlySet<string>
  maxFiles?: number
  /** Rows from the persistent AST index's `dependencies` table, if available. */
  dependencyRows?: readonly DependencyRow[]
  /** Overrides reading `.railsforge/runtime.json`. */
  runtimeSnapshot?: RuntimeSnapshot | null
  /** Clock for `provenance.builtAt` (tests). */
  now?: () => number
}

function readIfExists(file: string): string | undefined {
  try { return fs.readFileSync(file, 'utf8') } catch { return undefined }
}

/** Project-relative POSIX path -> file, for the files scanned into the graph. */
export interface ScannedFile { rel: string; full: string; mtimeMs: number; size: number }

/** Files the graph scans (stat only), in deterministic order, capped at `maxFiles`. */
function scanTree(root: string, excluded: ReadonlySet<string>, maxFiles: number): { files: ScannedFile[]; truncated: boolean } {
  const files: ScannedFile[] = []
  let truncated = false
  const walk = (dir: string): void => {
    if (truncated) {return}
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (truncated) {return}
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) {walk(full)}
      } else if (SOURCE_EXT.test(entry.name)) {
        let stat: fs.Stats
        try { stat = fs.statSync(full) } catch { continue }
        if (stat.size > MAX_FILE_BYTES) {continue}
        if (files.length >= maxFiles) {truncated = true; return}
        files.push({ rel: path.relative(root, full).split(path.sep).join('/'), full, mtimeMs: stat.mtimeMs, size: stat.size })
      }
    }
  }
  for (const dir of SCAN_DIRS) {walk(path.join(root, dir))}
  return { files, truncated }
}

/** Project-relative paths of the scanned source files (used for staleness checks; reads nothing). */
export function listSourcePaths(root: string, excluded: ReadonlySet<string>, maxFiles: number): string[] {
  return scanTree(root, excluded, maxFiles).files.map(f => f.rel)
}

export function collectSourceFiles(root: string, excluded: ReadonlySet<string>, maxFiles: number): SourceFile[] {
  return scanTree(root, excluded, maxFiles).files.flatMap(f => {
    try { return [{ path: f.rel, content: fs.readFileSync(f.full, 'utf8') }] } catch { return [] }
  })
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
  const builtAt = (options.now ?? Date.now)()
  const excluded = options.excludedDirNames ?? DEFAULT_EXCLUDED

  const schema = new SchemaIndexer()
  const schemaText = readIfExists(path.join(root, 'db', 'schema.rb'))
  if (schemaText) {schema.parseSchema(schemaText)}
  graph.add(schemaFacts(schema.getAllTables()))

  const routes = new RoutesIndexer()
  const routesText = readIfExists(path.join(root, 'config', 'routes.rb'))
  if (routesText) {routes.parseRoutesDsl(routesText)}
  graph.add(routesFacts(routes.getAllRoutes()))

  const scan = scanTree(root, excluded, options.maxFiles ?? 6000)
  const files: SourceFile[] = scan.files.flatMap(f => {
    try { return [{ path: f.rel, content: fs.readFileSync(f.full, 'utf8') }] } catch { return [] }
  })
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
  graph.provenance = buildProvenance(root, builtAt, scan, Boolean(snapshot))
  return graph
}

function mtimeOf(file: string): number | undefined {
  try { return fs.statSync(file).mtimeMs } catch { return undefined }
}

function buildProvenance(root: string, builtAt: number, scan: { files: ScannedFile[]; truncated: boolean }, hasRuntimeSnapshot: boolean): GraphProvenance {
  const inputs: GraphInput[] = scan.files.map(f => ({ path: f.rel, mtimeMs: f.mtimeMs, size: f.size }))
  const absent: string[] = []
  for (const rel of WELL_KNOWN_INPUTS) {
    try {
      const stat = fs.statSync(path.join(root, rel))
      inputs.push({ path: rel, mtimeMs: stat.mtimeMs, size: stat.size })
    } catch {
      absent.push(rel)
    }
  }
  // Runtime facts describe the app as it was when someone last ran the introspection; code changed
  // since then (schema or any model) means they may no longer match.
  const runtimeMtime = mtimeOf(path.join(root, '.railsforge', 'runtime.json'))
  let newestSource = mtimeOf(path.join(root, 'db', 'schema.rb')) ?? 0
  for (const f of scan.files) {
    if (f.rel.startsWith('app/models/') && f.mtimeMs > newestSource) {newestSource = f.mtimeMs}
  }
  return {
    root, builtAt, inputs, absent, truncated: scan.truncated,
    hasRuntimeSnapshot, runtimeStale: runtimeMtime !== undefined && runtimeMtime < newestSource,
  }
}
