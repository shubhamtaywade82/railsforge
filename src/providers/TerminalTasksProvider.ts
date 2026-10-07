/**
 * TerminalTasksProvider - wraps `vscode.tasks.*` (Task Provider) and
 * `vscode.window.createTerminal` (Terminal automation).
 *
 * Two distinct surfaces live here:
 *
 *   1. **Task Discovery** - `tasks.registerTaskProvider` automatically populates the
 *      "Run Task" menu with `rails server`, `rails db:migrate`, `sidekiq`, `rspec`,
 *      etc., based on the Gemfile. The actual task catalog (which gems imply which
 *      tasks) lives in `src/tasks/RailsTaskCatalog.ts`.
 *
 *   2. **Terminal Automation** - `window.createTerminal` runs shell commands silently
 *      in the background. Used by the Worktree Automation flow:
 *        - `git worktree add ../rails-app-feature-x feature-x`
 *        - `cp storage/*.sqlite3 ../rails-app-feature-x/storage/`
 *      The user does not see the terminal output; only the success/failure modal.
 */

import * as vscode from 'vscode'
import { SemanticIndex } from './SemanticIndex'
import { PatternCatalogAccess } from './PatternCatalogAccess'

/** Stable task type - must match `contributes.taskDefinitions` in package.json. */
export const RAILSFORGE_TASK_TYPE = 'railsforge'

/** Task provider factory - returns a `vscode.TaskProvider`. */
export interface TaskProviderFactory {
  (index: SemanticIndex, catalog: PatternCatalogAccess): vscode.TaskProvider
}

/**
 * Wraps `vscode.tasks.registerTaskProvider` and exposes the terminal automation API.
 */
export class TerminalTasksProvider implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []
  private readonly terminals: vscode.Terminal[] = []

  constructor(
    private readonly index: SemanticIndex,
    private readonly catalog: PatternCatalogAccess,
    private readonly workspaceRoot: string | undefined,
    private readonly taskProviderFactory?: TaskProviderFactory,
  ) {}

  activate(): void {
    if (this.taskProviderFactory) {
      try {
        const provider = this.taskProviderFactory(this.index, this.catalog)
        const disposable = vscode.tasks.registerTaskProvider(RAILSFORGE_TASK_TYPE, provider)
        this.disposables.push(disposable)
      } catch (err) {
        console.warn('[RailsForge] TerminalTasksProvider: task provider registration failed:', err)
      }
    }
  }

  /**
   * Execute a shell command silently in a background terminal. Used by Worktree
   * Automation and other Rails CLI flows where the user should not be bothered with
   * terminal output.
   *
   * @param command The shell command to execute.
   * @param cwd Working directory. Defaults to the primary workspace root.
   * @param name Display name for the terminal in the IDE.
   * @returns The Terminal object. Callers can listen on `terminal.exitStatus` or use
   *          `executeCommand` below which returns a Promise that resolves on exit.
   */
  createBackgroundTerminal(command: string, cwd?: string, name = 'RailsForge'): vscode.Terminal {
    const root = cwd ?? this.workspaceRoot
    const terminal = vscode.window.createTerminal({
      name,
      cwd: root,
      hideFromUser: true, // silent - the user does not see this terminal
    })
    this.terminals.push(terminal)
    terminal.show(false)
    terminal.sendText(command, true)
    return terminal
  }

  /**
   * Execute a shell command and resolve with the exit code. Wraps
   * `window.createTerminal` + `onDidCloseTerminal`. Used by Worktree Automation.
   */
  async executeCommand(command: string, cwd?: string, name = 'RailsForge'): Promise<number> {
    return new Promise<number>(resolve => {
      const terminal = this.createBackgroundTerminal(command, cwd, name)
      const subscription = vscode.window.onDidCloseTerminal(closed => {
        if (closed === terminal) {
          subscription.dispose()
          resolve(closed.exitStatus?.code ?? 0)
        }
      })
    })
  }

  /**
   * Run a `bundle exec` command (rspec, rails, rake) in a visible terminal. Unlike
   * `createBackgroundTerminal`, this opens the terminal in the foreground so the user
   * can see live output (test progress, server logs).
   */
  runInForeground(command: string, cwd?: string, name = 'RailsForge'): vscode.Terminal {
    const root = cwd ?? this.workspaceRoot
    const terminal = vscode.window.createTerminal({
      name,
      cwd: root,
    })
    this.terminals.push(terminal)
    terminal.show(true)
    terminal.sendText(command, true)
    return terminal
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose()
    }
    for (const t of this.terminals) {
      // Don't dispose terminals that are still running user-facing commands - just
      // drop our reference. VS Code owns the lifetime.
      if (t.exitStatus) {
        t.dispose()
      }
    }
    this.disposables.length = 0
    this.terminals.length = 0
  }
}
