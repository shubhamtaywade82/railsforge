/**
 * RakeTaskTreeProvider - Sidebar tree of Rake tasks (grouped by namespace), each with
 * a "Run" inline action. Data comes from RakeTaskIndexer's async `rake -T`, so this
 * caches the last-fetched list and exposes `refresh()` to re-run it — same
 * EventEmitter-based refresh pattern as RailsArchitectureTreeProvider.
 */

import * as vscode from 'vscode'
import { RakeTask, RakeTaskIndexer } from './RakeTaskIndexer'

export class RakeTaskItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly task?: RakeTask,
  ) {
    super(label, collapsibleState)
    if (task) {
      this.description = task.description
      this.tooltip = `rake ${task.name}${task.description ? `\n${task.description}` : ''}`
      this.iconPath = new vscode.ThemeIcon('play')
      this.contextValue = 'rakeTask'
      this.command = {
        command: 'railsforge.runRakeTask',
        title: 'Run Rake Task',
        arguments: [task.name],
      }
    } else {
      this.iconPath = new vscode.ThemeIcon('folder')
      this.contextValue = 'rakeNamespace'
    }
  }
}

export class RakeTaskTreeProvider implements vscode.TreeDataProvider<RakeTaskItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RakeTaskItem | undefined | void>()
  readonly onDidChangeTreeData: vscode.Event<RakeTaskItem | undefined | void> = this._onDidChangeTreeData.event

  private tasks: RakeTask[] = []
  private loaded = false

  constructor(private indexer: RakeTaskIndexer, private workspaceRoot: string) {}

  setRoot(root: string): void {
    this.workspaceRoot = root
    this.refresh()
  }

  refresh(): void {
    this.loaded = false
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: RakeTaskItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: RakeTaskItem): Promise<RakeTaskItem[]> {
    if (!this.workspaceRoot) {return []}
    if (!this.loaded) {
      this.tasks = await this.indexer.listTasks(this.workspaceRoot)
      this.loaded = true
    }

    if (!element) {
      const namespaces = [...new Set(this.tasks.map(t => t.namespace).filter((n): n is string => n !== null))].sort()
      const topLevel = this.tasks.filter(t => t.namespace === null).map(t => new RakeTaskItem(t.name, vscode.TreeItemCollapsibleState.None, t))
      const namespaceItems = namespaces.map(ns => new RakeTaskItem(ns, vscode.TreeItemCollapsibleState.Collapsed))
      return [...namespaceItems, ...topLevel]
    }

    if (element.contextValue === 'rakeNamespace') {
      return this.tasks
        .filter(t => t.namespace === element.label)
        .map(t => new RakeTaskItem(t.name, vscode.TreeItemCollapsibleState.None, t))
    }

    return []
  }
}
