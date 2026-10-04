/**
 * PersistentIndexManager - vscode-facing lifecycle for the Phase 12 AST/SQLite index.
 *
 * Wraps PersistentIndexClient (worker thread + SQLite) with workspace scanning/watching
 * and exposes PersistentDependencyGraph (Phase 11: cycles) and DuplicateMethodDetector
 * (Phase 8: cross-file near-duplicate methods) on top of it.
 *
 * Deliberately fails soft: if the native modules can't load on some platform, or the
 * worker fails to start, `activate()` logs a warning and returns null instead of
 * throwing — Phase 8/11/13/14 features become unavailable, but the rest of RailsForge
 * (everything built before this session) keeps working exactly as it did.
 */

import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { PersistentIndexClient } from './PersistentIndexClient'
import { PersistentDependencyGraph } from './PersistentDependencyGraph'
import { DuplicateMethodDetector } from './DuplicateMethodDetector'
import { getPersistentIndexSupport } from './nativeSupport'
import { readConfig, buildExcludeGlob } from '../config/RailsForgeConfig'
import { Logger } from '../util/Logger'

const INDEXED_GLOB = '{app,lib}/**/*.rb'
// Always excluded regardless of railsForge.excludePatterns: this index is specifically
// app/lib source (see INDEXED_GLOB), so spec/test files never belong in it even if a
// user's exclude list doesn't happen to mention them.
const ALWAYS_EXCLUDED = ['**/spec/**', '**/test/**']

function resolveExcludeGlob(): string {
  return buildExcludeGlob([...readConfig().excludePatterns, ...ALWAYS_EXCLUDED]) ?? `{${ALWAYS_EXCLUDED.join(',')}}`
}

export type PersistentIndexResult =
  | { status: 'ready'; manager: PersistentIndexManager }
  | { status: 'unsupported'; reason: string }
  | { status: 'failed'; reason: string }

export class PersistentIndexManager implements vscode.Disposable {
  readonly dependencyGraph: PersistentDependencyGraph
  readonly duplicateDetector: DuplicateMethodDetector
  private readonly disposables: vscode.Disposable[] = []

  private constructor(
    private client: PersistentIndexClient,
    private workspaceRoot: string,
  ) {
    this.dependencyGraph = new PersistentDependencyGraph(client.getDb())
    this.duplicateDetector = new DuplicateMethodDetector(client.getDb())
  }

  /**
   * Starts the index for ONE workspace root (its own SQLite file, worker and watchers).
   * Never throws: the outcome says whether it is ready, unsupported on this runtime
   * (with the reason) or failed, so callers can tell the user instead of going silent.
   */
  static async activate(context: vscode.ExtensionContext, workspaceRoot: string): Promise<PersistentIndexResult> {
    // Must run before anything in this call touches better-sqlite3, directly or
    // transitively (see database.ts's doc comment) — on an unsupported runtime,
    // loading that native module aborts the whole process, which no try/catch below
    // can protect against.
    const support = getPersistentIndexSupport()
    if (!support.supported) {
      const reason = support.reason ?? 'unsupported runtime'
      Logger.warn(`RailsForge: persistent AST index unavailable — ${reason} AST features (duplicate methods, dependency cycles) are skipped; all core RailsForge features remain fully active.`)
      return { status: 'unsupported', reason }
    }

    try {
      // Workspace-local (not VS Code's opaque per-workspace global storage) so the
      // standalone MCP server (src/mcp/server.ts, run outside the extension host) can
      // find and read the same index just by knowing the workspace root — no need to
      // reconstruct VS Code's internal storage-path hashing. Should be gitignored by
      // the user's project, same as any other local build/cache artifact.
      const storageDir = path.join(workspaceRoot, '.railsforge')
      fs.mkdirSync(storageDir, { recursive: true })
      const dbPath = path.join(storageDir, 'index.sqlite3')
      const workerPath = path.join(context.extensionPath, 'dist', 'indexer', 'indexer.worker.js')

      const client = await PersistentIndexClient.create(workerPath, dbPath)
      const manager = new PersistentIndexManager(client, workspaceRoot)

      await manager.scanWorkspace()
      manager.watch()

      return { status: 'ready', manager }
    } catch (err) {
      // Native module unavailable, worker failed to start, etc. — degrade, don't break activation.
      Logger.error(`RailsForge: persistent AST index failed to start for ${workspaceRoot}.`, err)
      return { status: 'failed', reason: err instanceof Error ? err.message : String(err) }
    }
  }

  get root(): string {
    return this.workspaceRoot
  }

  private async scanWorkspace(): Promise<void> {
    // Scoped to this manager's root: in a multi-root workspace each root has its own index.
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(this.workspaceRoot, INDEXED_GLOB), resolveExcludeGlob())
    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file.fsPath, 'utf8')
        await this.client.indexFile(file.fsPath, content)
      } catch {
        // Skip unreadable/binary files rather than aborting the whole scan.
      }
    }
  }

  private watch(): void {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.workspaceRoot, INDEXED_GLOB))
    this.disposables.push(watcher)
    const reindex = async (uri: vscode.Uri): Promise<void> => {
      try {
        if (fs.existsSync(uri.fsPath)) {
          const content = await fs.promises.readFile(uri.fsPath, 'utf8')
          await this.client.indexFile(uri.fsPath, content)
        } else {
          await this.client.removeFile(uri.fsPath)
        }
      } catch {
        // Skip unreadable files
      }
    }
    watcher.onDidChange(reindex)
    watcher.onDidCreate(reindex)
    watcher.onDidDelete(uri => void this.client.removeFile(uri.fsPath))
  }

  dispose(): void {
    for (const d of this.disposables) {d.dispose()}
    this.disposables.length = 0
    this.client.dispose()
  }
}
