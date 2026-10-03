/**
 * ToolContext - everything the RailsForge tools need to read about ONE project root.
 * vscode-free, so the same tool handlers run in the standalone MCP server process and
 * inside the extension host (as VS Code Language Model tools).
 */

import * as fs from 'fs'
import * as path from 'path'
import { SchemaIndexer } from '../../rails/SchemaIndexer'
import { RoutesIndexer } from '../../rails/RoutesIndexer'
import { ProjectPatternIndexer } from '../../patterns/ProjectPatternIndexer'
import { openIndexDatabase } from '../../indexer/database'
import { isPersistentIndexSupported } from '../../indexer/nativeSupport'
import { ApiDockClient } from '../../docs/ApiDockClient'
import { ApiDockMethodIndex } from '../../docs/ApiDockMethodIndex'
import { RubyDocProvider } from '../../docs/RubyDocProvider'
import { parseGemfileLock } from '../../gems/GemfileLockParser'
import { DevDocsOfflineIndex } from '../../docs/DevDocsOfflineIndex'
import { RBSIndex } from '../../types/RBSIndex'

const DEFAULT_EXCLUDED_DIR_NAMES = ['node_modules', 'vendor', 'tmp', 'log', '.git', 'coverage']

// Strips line comments and block comments from JSONC so plain JSON.parse can read a VS Code settings.json.
function stripJsonComments(text: string): string {
  return text.replace(/"(?:[^"\\]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, match =>
    match.startsWith('"') ? match : '',
  )
}

/**
 * Honors `railsForge.excludePatterns` from the project's `.vscode/settings.json` (the standalone
 * server has no `vscode.workspace.getConfiguration`); falls back to sane defaults.
 */
export function loadExcludedDirNames(root: string): Set<string> {
  try {
    const settingsPath = path.join(root, '.vscode', 'settings.json')
    if (!fs.existsSync(settingsPath)) {return new Set(DEFAULT_EXCLUDED_DIR_NAMES)}
    const json = JSON.parse(stripJsonComments(fs.readFileSync(settingsPath, 'utf8'))) as Record<string, unknown>
    const patterns = json['railsForge.excludePatterns']
    if (!Array.isArray(patterns) || patterns.length === 0) {return new Set(DEFAULT_EXCLUDED_DIR_NAMES)}
    const dirNames = patterns
      .filter((p): p is string => typeof p === 'string')
      .map(p => p.replace(/^\*\*\//, '').replace(/\/\*\*$/, '').replace(/\/\*+$/, ''))
      .filter(Boolean)
    return dirNames.length > 0 ? new Set(dirNames) : new Set(DEFAULT_EXCLUDED_DIR_NAMES)
  } catch {
    return new Set(DEFAULT_EXCLUDED_DIR_NAMES)
  }
}

export class ToolContext {
  readonly excludedDirNames: Set<string>
  readonly apiDockClient = new ApiDockClient()
  readonly apiDockMethodIndex = new ApiDockMethodIndex()
  readonly rubyDocProvider = new RubyDocProvider()
  private devDocsIndex: DevDocsOfflineIndex | null = null
  private rbsIndex: RBSIndex | null = null

  constructor(readonly workspaceRoot: string) {
    this.excludedDirNames = loadExcludedDirNames(workspaceRoot)
  }

  loadSchemaIndexer(): SchemaIndexer {
    const indexer = new SchemaIndexer()
    const schemaPath = path.join(this.workspaceRoot, 'db', 'schema.rb')
    if (fs.existsSync(schemaPath)) {indexer.parseSchema(fs.readFileSync(schemaPath, 'utf8'))}
    return indexer
  }

  loadRoutesIndexer(): RoutesIndexer {
    const indexer = new RoutesIndexer()
    const routesPath = path.join(this.workspaceRoot, 'config', 'routes.rb')
    if (fs.existsSync(routesPath)) {indexer.parseRoutesDsl(fs.readFileSync(routesPath, 'utf8'))}
    return indexer
  }

  loadPatternIndexer(): ProjectPatternIndexer {
    const indexer = new ProjectPatternIndexer()
    for (const dir of ['app', 'lib']) {
      this.walkRubyFiles(path.join(this.workspaceRoot, dir), file => {
        indexer.indexFile(file, fs.readFileSync(file, 'utf8'))
      })
    }
    return indexer
  }

  private walkRubyFiles(dir: string, onFile: (filePath: string) => void): void {
    if (!fs.existsSync(dir)) {return}
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (this.excludedDirNames.has(entry.name)) {continue}
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        this.walkRubyFiles(full, onFile)
      } else if (entry.name.endsWith('.rb')) {
        try { onFile(full) } catch { /* Skip unreadable files. */ }
      }
    }
  }

  /** Read-only handle on the persistent AST index, or null when unsupported/not built yet. */
  openPersistentDbReadonly(): ReturnType<typeof openIndexDatabase> | null {
    // Must come before the require('better-sqlite3') inside openIndexDatabase — see database.ts:
    // an unsupported runtime can't be recovered from via try/catch.
    if (!isPersistentIndexSupported()) {return null}
    const dbPath = path.join(this.workspaceRoot, '.railsforge', 'index.sqlite3')
    if (!fs.existsSync(dbPath)) {return null}
    try {
      return openIndexDatabase(dbPath, true)
    } catch {
      return null
    }
  }

  loadLockedGemVersions(): Map<string, string> {
    const lockPath = path.join(this.workspaceRoot, 'Gemfile.lock')
    if (!fs.existsSync(lockPath)) {return new Map()}
    return parseGemfileLock(fs.readFileSync(lockPath, 'utf8'))
  }

  /** Built once per context: DevDocsOfflineIndex lazily parses ~10-15MB docsets and keeps them in memory. */
  getDevDocsIndex(): DevDocsOfflineIndex {
    if (this.devDocsIndex) {return this.devDocsIndex}
    const cacheDir = path.join(this.workspaceRoot, '.railsforge', 'devdocs')
    let slugs: string[] = []
    try {
      slugs = fs.readdirSync(cacheDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
    } catch {
      slugs = []
    }
    this.devDocsIndex = new DevDocsOfflineIndex(cacheDir, slugs)
    return this.devDocsIndex
  }

  getRbsIndex(): RBSIndex {
    if (!this.rbsIndex) {
      this.rbsIndex = new RBSIndex()
      this.rbsIndex.loadFromWorkspace(this.workspaceRoot, 'sig')
    }
    return this.rbsIndex
  }
}
