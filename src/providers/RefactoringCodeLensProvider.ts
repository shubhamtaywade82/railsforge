/**
 * RefactoringCodeLensProvider - shows refactoring opportunities above the classes, methods and loops
 * where they were measured.
 *
 * The lens is deterministic and cheap, so it updates as the developer types (VS Code asks again after
 * each edit). It shows only medium and high confidence findings, to keep the editor quiet, and it can
 * be turned off with `railsForge.refactoring.codeLens`.
 */

import * as vscode from 'vscode'
import { SUGGEST_REFACTORINGS_COMMAND } from '../refactoring-intelligence/vscode/RefactoringCommand'
import { RefactoringEngine } from '../refactoring-intelligence/core/RefactoringEngine'
import type { Recommendation } from '../refactoring-intelligence/core/types'

export interface RefactoringCodeLensDeps {
  engine: RefactoringEngine
  /** Workspace-relative path of a document, or undefined when it is outside the project. */
  pathOf: (uri: vscode.Uri) => string | undefined
  enabled: () => boolean
}

export class RefactoringCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeCodeLenses = this.changed.event

  constructor(private readonly deps: RefactoringCodeLensDeps) {}

  refresh(): void {
    this.changed.fire()
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.deps.enabled() || document.languageId !== 'ruby') {return []}
    const relativePath = this.deps.pathOf(document.uri)
    if (!relativePath) {return []}

    const content = document.getText()
    const visible = this.deps.engine.allRecommendations(relativePath, content).filter(r => r.confidence !== 'low')
    if (visible.length === 0) {return []}

    const lenses: vscode.CodeLens[] = []
    for (const scope of this.deps.engine.scopes(content)) {
      const anchored = visible.filter(r => r.scope.kind === scope.kind && r.scope.startLine === scope.startLine)
      if (anchored.length > 0) {lenses.push(lensFor(document, scope.startLine, scope.endLine, anchored))}
    }
    for (const block of visible.filter(r => r.scope.kind === 'block')) {
      lenses.push(lensFor(document, block.scope.startLine, block.scope.endLine, [block]))
    }
    return lenses
  }
}

function lensFor(document: vscode.TextDocument, startLine: number, endLine: number, recommendations: Recommendation[]): vscode.CodeLens {
  const top = recommendations[0].priority
  const count = recommendations.length
  const range = new vscode.Range(startLine - 1, 0, startLine - 1, 0)
  return new vscode.CodeLens(range, {
    title: `✦ RailsForge: ${count} refactoring ${count === 1 ? 'opportunity' : 'opportunities'} · ${top}`,
    command: SUGGEST_REFACTORINGS_COMMAND,
    arguments: [document.uri, new vscode.Range(startLine - 1, 0, endLine - 1, 0)],
  })
}
