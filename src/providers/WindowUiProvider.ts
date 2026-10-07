/**
 * WindowUiProvider - wraps every `vscode.window.*` surface RailsForge needs.
 *
 * VS Code's `window` namespace is a grab-bag of UI surfaces: tree views, quick picks,
 * input boxes, webview panels, status bar progress, warning/info messages. This class
 * is the single point of registration - the registry owns the lifetime, and no other
 * provider in `src/providers/` calls `vscode.window.createTreeView` or
 * `vscode.window.createWebviewPanel` directly.
 *
 * Status bar progress (`window.withProgress`) is exposed as a method rather than a
 * registration - the WorkspaceFsProvider calls `withProgress()` while building the
 * SQLite Semantic Index on workspace open.
 */

import * as vscode from 'vscode'
import { SemanticIndex } from './SemanticIndex'
import { PatternCatalogAccess } from './PatternCatalogAccess'

/** Tree view factories - one per `window.createTreeView` call. Key is the view id. */
export type TreeViewFactory = (index: SemanticIndex, catalog: PatternCatalogAccess) => vscode.TreeView<unknown>

/** Webview panel factories - one per `window.createWebviewPanel` call. */
export type WebviewPanelFactory = (
  index: SemanticIndex,
  catalog: PatternCatalogAccess,
  panel: vscode.WebviewPanel,
) => void

/**
 * Configuration for the WindowUiProvider. The registry supplies these factories based
 * on which features the user has enabled in settings.
 */
export interface WindowUiConfig {
  /** Map of view id (must match package.json `contributes.views`) -> tree view factory. */
  treeViews?: Record<string, TreeViewFactory>
  /** Map of panel id (internal, not exposed in package.json) -> webview factory. */
  webviewPanels?: Record<string, WebviewPanelFactory>
}

/**
 * Wraps `vscode.window.createTreeView`, `vscode.window.createWebviewPanel`,
 * `vscode.window.showQuickPick`, `vscode.window.showInputBox`, `vscode.window.withProgress`,
 * `vscode.window.showWarningMessage`, and the related status-bar surfaces.
 */
export class WindowUiProvider implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []
  private readonly treeViews = new Map<string, vscode.TreeView<unknown>>()
  private readonly webviewPanels = new Map<string, vscode.WebviewPanel>()

  constructor(
    private readonly index: SemanticIndex,
    private readonly catalog: PatternCatalogAccess,
    private readonly config: WindowUiConfig,
  ) {}

  activate(): void {
    if (this.config.treeViews) {
      for (const [viewId, factory] of Object.entries(this.config.treeViews)) {
        try {
          const view = factory(this.index, this.catalog)
          this.treeViews.set(viewId, view)
          this.disposables.push(view)
        } catch (err) {
          console.warn(`[RailsForge] WindowUiProvider: tree view "${viewId}" registration failed:`, err)
        }
      }
    }
  }

  /**
   * Show a QuickPick dropdown - used by the Pattern Explorer when the user clicks a
   * "3 similar services" CodeLens.
   */
  async showQuickPick<T extends vscode.QuickPickItem>(items: readonly T[], options: vscode.QuickPickOptions): Promise<T | undefined> {
    return vscode.window.showQuickPick(items as T[], options)
  }

  /**
   * Show an InputBox - used to ask the user for the name of a new Query Object during
   * an extraction flow.
   */
  async showInputBox(options: vscode.InputBoxOptions): Promise<string | undefined> {
    return vscode.window.showInputBox(options)
  }

  /**
   * Open (or focus) a webview panel - used for the embedded DevDocs / RailsDiff iframe.
   * If a panel with the same id already exists, it is revealed rather than re-created.
   */
  async openWebviewPanel(panelId: string, title: string, options: vscode.WebviewPanelOptions & vscode.WebviewOptions): Promise<vscode.WebviewPanel | undefined> {
    const existing = this.webviewPanels.get(panelId)
    if (existing) {
      existing.reveal(existing.viewColumn ?? vscode.ViewColumn.Active, false)
      return existing
    }
    const panel = vscode.window.createWebviewPanel(
      panelId,
      title,
      vscode.ViewColumn.Active,
      options,
    )
    this.webviewPanels.set(panelId, panel)
    this.disposables.push(panel)
    panel.onDidDispose(() => {
      this.webviewPanels.delete(panelId)
    }, null, this.disposables)

    const factory = this.config.webviewPanels?.[panelId]
    if (factory) {
      try {
        factory(this.index, this.catalog, panel)
      } catch (err) {
        console.warn(`[RailsForge] WindowUiProvider: webview panel "${panelId}" factory failed:`, err)
      }
    }
    return panel
  }

  /**
   * Run a long-running task with a non-blocking progress bar in the status bar.
   * Used while the SQLite Semantic Index is being built on workspace open.
   */
  async withProgress<T>(
    title: string,
    task: (report: (increment: number, message?: string) => void, token: vscode.CancellationToken) => Promise<T>,
  ): Promise<T> {
    return vscode.window.withProgress<T>(
      {
        location: vscode.ProgressLocation.Window,
        title,
        cancellable: true,
      },
      async (progress, token) => {
        let lastIncrement = 0
        return task((increment, message) => {
          const delta = Math.max(0, increment - lastIncrement)
          lastIncrement = increment
          progress.report({ increment: delta, message })
        }, token)
      },
    )
  }

  /**
   * Show a modal warning - used when TDD Strict Mode blocks a file save because the
   * corresponding spec file is missing.
   */
  async showWarningMessage<T extends vscode.MessageItem>(message: string, ...items: T[]): Promise<T | undefined> {
    return vscode.window.showWarningMessage(message, ...items)
  }

  /** Show an informational message. */
  async showInformationMessage<T extends vscode.MessageItem>(message: string, ...items: T[]): Promise<T | undefined> {
    return vscode.window.showInformationMessage(message, ...items)
  }

  /** Show an error message. */
  async showErrorMessage<T extends vscode.MessageItem>(message: string, ...items: T[]): Promise<T | undefined> {
    return vscode.window.showErrorMessage(message, ...items)
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables.length = 0
    this.treeViews.clear()
    this.webviewPanels.clear()
  }
}
