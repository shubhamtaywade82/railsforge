/**
 * PatternCatalogTreeProvider - sidebar catalog of design patterns. Clicking a pattern opens its
 * explanation in the editor (`railsforge:/pattern/<id>.md`) rather than a web page; patterns that
 * map to a project directory (services, queries, forms, policies, decorators) expand to the
 * project's own classes, each opening its file at the class line.
 */

import * as vscode from 'vscode'
import * as path from 'path'
import {
  CATEGORY_LABELS, CATEGORY_ORDER, CatalogPattern, PatternCategory, ProjectInstance, getCatalogPattern, patternsInCategory,
} from '../patterns/PatternCatalog'
import { PatternType } from '../patterns/ProjectPatternIndexer'

type NodeKind = 'category' | 'pattern' | 'instance' | 'empty'

const CATEGORY_ICONS: Record<PatternCategory, string> = {
  rails: 'ruby', behavioral: 'zap', structural: 'layers', creational: 'extensions',
}

export class PatternItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly nodeKind: NodeKind,
    public readonly patternId?: string,
    public readonly category?: PatternCategory,
  ) {
    super(label, collapsibleState)
  }
}

export interface PatternCatalogSource {
  /** Root of the project that owns the active editor. */
  getRoot(): string | undefined
  /** The project's classes of one kind, workspace-relative. Called lazily on expand. */
  loadInstances(root: string, kind: PatternType): ProjectInstance[]
}

export class PatternCatalogTreeProvider implements vscode.TreeDataProvider<PatternItem> {
  private readonly emitter = new vscode.EventEmitter<PatternItem | undefined | void>()
  readonly onDidChangeTreeData = this.emitter.event

  constructor(private readonly source: PatternCatalogSource) {}

  refresh(): void {
    this.emitter.fire()
  }

  getTreeItem(element: PatternItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: PatternItem): PatternItem[] {
    if (!element) {return CATEGORY_ORDER.map(c => this.categoryItem(c))}
    if (element.nodeKind === 'category' && element.category) {
      return patternsInCategory(element.category).map(p => this.patternItem(p))
    }
    if (element.nodeKind === 'pattern' && element.patternId) {
      return this.instanceItems(getCatalogPattern(element.patternId))
    }
    return []
  }

  private categoryItem(category: PatternCategory): PatternItem {
    const item = new PatternItem(
      CATEGORY_LABELS[category],
      category === 'rails' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
      'category', undefined, category,
    )
    item.iconPath = new vscode.ThemeIcon(CATEGORY_ICONS[category])
    item.contextValue = 'patternCategory'
    return item
  }

  private patternItem(pattern: CatalogPattern): PatternItem {
    const item = new PatternItem(
      pattern.name,
      pattern.projectKind ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      'pattern', pattern.id, pattern.category,
    )
    item.description = pattern.summary
    item.tooltip = pattern.intent
    item.iconPath = new vscode.ThemeIcon(CATEGORY_ICONS[pattern.category])
    item.contextValue = pattern.generateCommand ? 'pattern.generate' : 'pattern'
    item.command = { command: 'railsforge.openPattern', title: 'Open Pattern Explanation', arguments: [pattern.id] }
    return item
  }

  private instanceItems(pattern: CatalogPattern | undefined): PatternItem[] {
    const root = this.source.getRoot()
    if (!pattern?.projectKind || !root) {return []}
    const instances = this.source.loadInstances(root, pattern.projectKind)
    if (instances.length === 0) {
      const empty = new PatternItem(`No ${pattern.projectKind} classes in this project`, vscode.TreeItemCollapsibleState.None, 'empty')
      empty.iconPath = new vscode.ThemeIcon('info')
      return [empty]
    }
    return instances.map(i => {
      const item = new PatternItem(i.name, vscode.TreeItemCollapsibleState.None, 'instance')
      item.description = `${i.relativePath}:${i.line}`
      item.iconPath = new vscode.ThemeIcon('symbol-class')
      item.contextValue = 'patternInstance'
      const line = Math.max(0, i.line - 1)
      item.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [vscode.Uri.file(path.join(root, ...i.relativePath.split('/'))), { selection: new vscode.Range(line, 0, line, 0) }],
      }
      return item
    })
  }
}
