/**
 * RefactoringCodeActionProvider - the lightbulb for refactoring recommendations.
 *
 * Shown only when the cursor's scope has a recommendation at medium confidence or above. Producing
 * the action is free: it runs deterministic analysis (cached per file) and makes no model call. The
 * AI is reached only when the developer chooses the action.
 */

import * as vscode from 'vscode'
import { SUGGEST_REFACTORINGS_COMMAND } from '../refactoring-intelligence/vscode/RefactoringCommand'
import { RefactoringEngine } from '../refactoring-intelligence/core/RefactoringEngine'
import { describeTarget, TargetResolver } from '../refactoring-intelligence/core/ScopeResolver'
import { toSelectionLines } from '../refactoring-intelligence/vscode/workspacePaths'

export const REFACTORING_ACTION_KIND = vscode.CodeActionKind.Refactor.append('railsforge.advisor')

export interface RefactoringCodeActionDeps {
  engine: RefactoringEngine
  resolver: TargetResolver
  /** Workspace-relative path of a document, or undefined when it is outside the project. */
  pathOf: (uri: vscode.Uri) => string | undefined
}

export class RefactoringCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [REFACTORING_ACTION_KIND]

  constructor(private readonly deps: RefactoringCodeActionDeps) {}

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection): vscode.CodeAction[] {
    if (document.languageId !== 'ruby') {return []}
    const relativePath = this.deps.pathOf(document.uri)
    if (!relativePath) {return []}

    const content = document.getText()
    const resolution = this.deps.resolver.resolve(content, toSelectionLines(range))
    if (!resolution.ok) {return []}

    const suggestions = this.deps.engine
      .recommendations(relativePath, content, resolution.target)
      .filter(r => r.confidence !== 'low')
    if (suggestions.length === 0) {return []}

    const label = describeTarget(resolution.target)
    const count = suggestions.length
    const action = new vscode.CodeAction(
      `RailsForge: ${count} refactoring ${count === 1 ? 'suggestion' : 'suggestions'} for ${label}`,
      REFACTORING_ACTION_KIND,
    )
    action.command = {
      command: SUGGEST_REFACTORINGS_COMMAND,
      title: `Review refactorings for ${label}`,
      arguments: [document.uri, range],
    }
    return [action]
  }
}
