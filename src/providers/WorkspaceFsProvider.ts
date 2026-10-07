/**
 * WorkspaceFsProvider - wraps `vscode.workspace.*` for the file-system, configuration,
 * and lifecycle surfaces that drive the Semantic Index and on-save hooks.
 *
 * The FileSystemWatcher is the engine that powers incremental indexing: when a Ruby
 * file under `app/`, `db/schema.rb`, or `config/routes.rb` changes, the watcher
 * triggers the background worker to re-parse just that file via Tree-sitter.
 *
 * `getConfiguration` reads `railsForge.principles.srp.maxClassLoc` and
 * `railsForge.tdd.strictMode` from `settings.json` - and the `onDidChangeConfiguration`
 * event lets providers react live without a reload.
 *
 * `workspaceFolders` enables multi-root workspace support: each Rails engine or
 * microservice gets its own isolated SQLite index, keyed by the workspace folder URI.
 */

import * as vscode from 'vscode'
import { SemanticIndex } from './SemanticIndex'
import { PatternCatalogAccess } from './PatternCatalogAccess'

/** Glob patterns that trigger an index refresh when changed. */
export const INDEXED_GLOBS = [
  'app/**/*.rb',
  'lib/**/*.rb',
  'db/schema.rb',
  'config/routes.rb',
  'config/routes/**/*.rb',
] as const

/** Settings namespace - all railsForge.* keys live under this. */
export const RAILSFORGE_CONFIG_SECTION = 'railsforge'

/** A handler invoked when a watched file changes. */
export interface FileChangeHandler {
  onCreated?(uri: vscode.Uri): void
  onChanged?(uri: vscode.Uri): void
  onDeleted?(uri: vscode.Uri): void
}

/** A handler invoked when a relevant `railsForge.*` setting changes. */
export type ConfigChangeHandler = (event: vscode.ConfigurationChangeEvent) => void

/** Save handler - invoked on `workspace.onDidSaveTextDocument`. */
export interface SaveHandler {
  (document: vscode.TextDocument): void
}

/**
 * Wraps `workspace.createFileSystemWatcher`, `workspace.getConfiguration`,
 * `workspace.workspaceFolders`, `workspace.onDidSaveTextDocument`, and
 * `workspace.onDidChangeConfiguration`.
 */
export class WorkspaceFsProvider implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []
  private readonly watchers: vscode.FileSystemWatcher[] = []
  private readonly fileChangeHandlers: FileChangeHandler[] = []
  private readonly configChangeHandlers: ConfigChangeHandler[] = []
  private readonly saveHandlers: SaveHandler[] = []
  private currentConfig: vscode.WorkspaceConfiguration

  constructor(
    private readonly index: SemanticIndex,
    private readonly catalog: PatternCatalogAccess,
  ) {
    this.currentConfig = vscode.workspace.getConfiguration(RAILSFORGE_CONFIG_SECTION)
  }

  activate(): void {
    // FileSystemWatcher - one per glob, so we can dispose and re-create them
    // individually if the user edits `railsForge.indexedGlobs` in settings.
    for (const pattern of INDEXED_GLOBS) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern)
      watcher.onDidCreate(uri => this.dispatchCreated(uri), null, this.disposables)
      watcher.onDidChange(uri => this.dispatchChanged(uri), null, this.disposables)
      watcher.onDidDelete(uri => this.dispatchDeleted(uri), null, this.disposables)
      this.watchers.push(watcher)
      this.disposables.push(watcher)
    }

    // Configuration changes - fire handlers for any railsForge.* key change.
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(RAILSFORGE_CONFIG_SECTION)) {
        this.currentConfig = vscode.workspace.getConfiguration(RAILSFORGE_CONFIG_SECTION)
        for (const handler of this.configChangeHandlers) {
          try {
            handler(event)
          } catch (err) {
            console.warn('[RailsForge] WorkspaceFsProvider: config change handler failed:', err)
          }
        }
      }
    }, null, this.disposables)

    // Save hooks - RuboCop autocorrect, Brakeman scans, AI Quick Fix caching.
    vscode.workspace.onDidSaveTextDocument(document => {
      for (const handler of this.saveHandlers) {
        try {
          handler(document)
        } catch (err) {
          console.warn(`[RailsForge] WorkspaceFsProvider: save handler failed for ${document.uri.fsPath}:`, err)
        }
      }
    }, null, this.disposables)
  }

  /**
   * Register a handler for file-change events under the indexed globs. The handler is
   * invoked on the extension host thread - it must not block. Long-running work (like
   * re-parsing the AST) should be queued to the indexer worker via the SemanticIndex.
   */
  onFileChange(handler: FileChangeHandler): void {
    this.fileChangeHandlers.push(handler)
  }

  /** Register a handler for `railsForge.*` configuration changes. */
  onConfigChange(handler: ConfigChangeHandler): void {
    this.configChangeHandlers.push(handler)
  }

  /** Register a handler for `workspace.onDidSaveTextDocument`. */
  onSave(handler: SaveHandler): void {
    this.saveHandlers.push(handler)
  }

  /**
   * Read a `railsForge.*` setting with optional default. Wraps
   * `workspace.getConfiguration('railsforge').get<T>(key, default)`.
   */
  getConfig<T>(key: string, defaultValue: T): T {
    return this.currentConfig.get<T>(key, defaultValue)
  }

  /** Update a `railsForge.*` setting (writes to user or workspace settings.json). */
  async setConfig<T>(key: string, value: T, target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace): Promise<void> {
    await this.currentConfig.update(key, value, target)
  }

  /**
   * Multi-root workspace support. Returns one root URI per folder, or undefined if
   * the user has no folder open. Each root gets its own isolated SQLite index.
   */
  workspaceRoots(): readonly vscode.WorkspaceFolder[] {
    return vscode.workspace.workspaceFolders ?? []
  }

  /** The first workspace folder - convenience for single-root workspaces. */
  primaryWorkspaceRoot(): vscode.WorkspaceFolder | undefined {
    return this.workspaceRoots()[0]
  }

  private dispatchCreated(uri: vscode.Uri): void {
    for (const handler of this.fileChangeHandlers) {
      handler.onCreated?.(uri)
    }
  }

  private dispatchChanged(uri: vscode.Uri): void {
    for (const handler of this.fileChangeHandlers) {
      handler.onChanged?.(uri)
    }
  }

  private dispatchDeleted(uri: vscode.Uri): void {
    for (const handler of this.fileChangeHandlers) {
      handler.onDeleted?.(uri)
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables.length = 0
    this.watchers.length = 0
    this.fileChangeHandlers.length = 0
    this.configChangeHandlers.length = 0
    this.saveHandlers.length = 0
  }
}
