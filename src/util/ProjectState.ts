/**
 * ProjectState - small typed wrapper over `workspaceState` for per-project UI memory
 * (last chosen analyzers, last generator, ...). Keys are namespaced; values are JSON-safe.
 */

import * as vscode from 'vscode'

export class ProjectState {
  constructor(private readonly memento: vscode.Memento) {}

  get<T>(key: string, fallback: T): T {
    return this.memento.get<T>(`railsforge.${key}`, fallback)
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.memento.update(`railsforge.${key}`, value)
  }
}
