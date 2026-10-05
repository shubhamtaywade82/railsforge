/**
 * RailsArchitectureTreeProvider - Sidebar tree view displaying project architecture and health
 */

import * as vscode from 'vscode'
import { ProjectEnvironment, formatProjectType } from '../environment/EnvironmentDetector'
import { SchemaIndexer } from '../rails/SchemaIndexer'
import { RoutesIndexer, RailsRoute } from '../rails/RoutesIndexer'
import { StimulusIndexer } from '../hotwire/StimulusIndexer'
import { VirtualDocKind } from './VirtualDocs'

/** Clicking a row opens the matching read-only `railsforge:` document in the editor. */
function opensDoc<T extends vscode.TreeItem>(item: T, kind: VirtualDocKind): T {
  item.command = { command: 'railsforge.openVirtualDoc', title: 'Open in Editor', arguments: [kind] }
  return item
}

export class ArchitectureItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly description?: string,
    public readonly iconPath?: vscode.ThemeIcon,
  ) {
    super(label, collapsibleState)
  }
}

export class RailsArchitectureTreeProvider implements vscode.TreeDataProvider<ArchitectureItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ArchitectureItem | undefined | void> = new vscode.EventEmitter<ArchitectureItem | undefined | void>()
  readonly onDidChangeTreeData: vscode.Event<ArchitectureItem | undefined | void> = this._onDidChangeTreeData.event

  constructor(
    private env: ProjectEnvironment,
    private schemaIndexer: SchemaIndexer,
    private routesIndexer: RoutesIndexer,
    private stimulusIndexer: StimulusIndexer,
    private getAstIndexStatus: () => string = () => 'Not started',
    private getToolchain: () => string = () => 'unknown',
  ) {}

  refresh(env: ProjectEnvironment): void {
    this.env = env
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: ArchitectureItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: ArchitectureItem): Thenable<ArchitectureItem[]> {
    if (!element) {
      return Promise.resolve(this.getRootItems())
    }

    if (element.label === 'Runtime Environment') {
      return Promise.resolve(this.getEnvironmentItems())
    }

    if (element.label === 'Database & Models') {
      return Promise.resolve(this.getDatabaseItems())
    }

    if (element.label === 'Routes & Hotwire') {
      return Promise.resolve(this.getRoutesHotwireItems())
    }

    if (element.contextValue === 'routeGroup') {
      return Promise.resolve(this.getRoutesForController(String(element.label)))
    }

    return Promise.resolve([])
  }

  private getRootItems(): ArchitectureItem[] {
    return [
      new ArchitectureItem(
        'Runtime Environment',
        vscode.TreeItemCollapsibleState.Expanded,
        `Ruby ${this.env.rubyVersion} | ${this.env.hasRails ? `Rails ${this.env.railsVersion}` : 'Not a Rails app'} | ${formatProjectType(this.env.projectType)}`,
        new vscode.ThemeIcon('ruby'),
      ),
      new ArchitectureItem(
        'Database & Models',
        vscode.TreeItemCollapsibleState.Collapsed,
        `${this.schemaIndexer.getAllTables().length} Tables Indexed`,
        new vscode.ThemeIcon('database'),
      ),
      opensDoc(new ArchitectureItem(
        'Code Analysis (AST index)',
        vscode.TreeItemCollapsibleState.None,
        this.getAstIndexStatus(),
        new vscode.ThemeIcon('symbol-structure'),
      ), 'graph'),
      new ArchitectureItem(
        'Routes & Hotwire',
        vscode.TreeItemCollapsibleState.Collapsed,
        `${this.routesIndexer.getAllRoutes().length} Routes | ${this.stimulusIndexer.getAllControllers().length} Controllers`,
        new vscode.ThemeIcon('zap'),
      ),
    ]
  }

  private getEnvironmentItems(): ArchitectureItem[] {
    return [
      opensDoc(new ArchitectureItem(`Ruby: ${this.env.rubyVersion}`, vscode.TreeItemCollapsibleState.None), 'toolchain'),
      opensDoc(new ArchitectureItem(`Toolchain: ${this.getToolchain()}`, vscode.TreeItemCollapsibleState.None), 'toolchain'),
      opensDoc(new ArchitectureItem(`Rails: ${this.env.hasRails ? this.env.railsVersion : 'Not detected (standalone Ruby project)'}`, vscode.TreeItemCollapsibleState.None), 'toolchain'),
      opensDoc(new ArchitectureItem(`Project Type: ${formatProjectType(this.env.projectType)}`, vscode.TreeItemCollapsibleState.None), 'toolchain'),
      opensDoc(new ArchitectureItem(`Hotwire / Turbo: ${this.env.hasHotwire ? 'Active ✓' : 'Inactive ✗'}`, vscode.TreeItemCollapsibleState.None), 'toolchain'),
      opensDoc(new ArchitectureItem(`Testing Framework: ${this.env.testFramework.toUpperCase()}`, vscode.TreeItemCollapsibleState.None), 'toolchain'),
      opensDoc(new ArchitectureItem(`Strong Migrations: ${this.env.hasStrongMigrations ? 'Enabled ✓' : 'Disabled ✗'}`, vscode.TreeItemCollapsibleState.None), 'toolchain'),
    ]
  }

  private getDatabaseItems(): ArchitectureItem[] {
    return this.schemaIndexer.getAllTables().map(t => {
      const colCount = t.columns.size
      return opensDoc(new ArchitectureItem(
        t.name,
        vscode.TreeItemCollapsibleState.None,
        `${colCount} columns`,
        new vscode.ThemeIcon('table'),
      ), 'schema')
    })
  }

  private getRoutesHotwireItems(): ArchitectureItem[] {
    const items: ArchitectureItem[] = [
      opensDoc(new ArchitectureItem(`Total Routes: ${this.routesIndexer.getAllRoutes().length}`, vscode.TreeItemCollapsibleState.None, undefined, new vscode.ThemeIcon('symbol-namespace')), 'routes'),
    ]

    const byController = new Map<string, RailsRoute[]>()
    for (const route of this.routesIndexer.getAllRoutes()) {
      const list = byController.get(route.controller) ?? []
      list.push(route)
      byController.set(route.controller, list)
    }

    for (const [controller, routes] of [...byController.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const group = new ArchitectureItem(
        controller,
        vscode.TreeItemCollapsibleState.Collapsed,
        `${routes.length} routes`,
        new vscode.ThemeIcon('symbol-method'),
      )
      group.contextValue = 'routeGroup'
      items.push(group)
    }

    for (const c of this.stimulusIndexer.getAllControllers()) {
      items.push(
        new ArchitectureItem(
          `Stimulus: ${c.identifier}`,
          vscode.TreeItemCollapsibleState.None,
          `${c.targets.length} targets, ${c.actions.length} actions`,
          new vscode.ThemeIcon('symbol-event'),
        ),
      )
    }

    return items
  }

  private getRoutesForController(controller: string): ArchitectureItem[] {
    return this.routesIndexer.getAllRoutes()
      .filter(r => r.controller === controller)
      .map(r => opensDoc(new ArchitectureItem(
        `${r.verb} ${r.uriPattern}`,
        vscode.TreeItemCollapsibleState.None,
        r.action,
        new vscode.ThemeIcon('symbol-method'),
      ), 'routes'))
  }
}
