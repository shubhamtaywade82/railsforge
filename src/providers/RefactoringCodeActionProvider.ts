/**
 * RefactoringCodeActionProvider - the lightbulb for refactoring hints.
 *
 * When the cursor's scope has AI hints observed for its current text, the lightbulb offers to review
 * them (no model call). Otherwise, when the scope has rule-based recommendations at medium confidence
 * or above, it offers those; choosing that asks the AI. Producing the action is always free.
 */

import * as vscode from 'vscode'
import { REVIEW_AI_HINTS_COMMAND, SUGGEST_REFACTORINGS_COMMAND } from '../refactoring-intelligence/vscode/RefactoringCommand'
import { RefactoringEngine } from '../refactoring-intelligence/core/RefactoringEngine'
import { observedWithin, ObservationStore } from '../refactoring-intelligence/core/ObservationStore'
import { describeTarget, TargetResolver } from '../refactoring-intelligence/core/ScopeResolver'
import { toSelectionLines } from '../refactoring-intelligence/vscode/workspacePaths'

export const REFACTORING_ACTION_KIND = vscode.CodeActionKind.Refactor.append('railsforge.advisor')

export interface RefactoringCodeActionDeps {
  engine: RefactoringEngine
  resolver: TargetResolver
  observations: ObservationStore
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

    const { engine, resolver, observations } = this.deps
    const content = document.getText()
    const resolution = resolver.resolve(content, toSelectionLines(range))
    if (!resolution.ok) {return []}
    const target = resolution.target
    const label = describeTarget(target)

    const observed = observedWithin(observations, relativePath, content, engine.scopes(content), target)
      .filter(r => r.confidence !== 'low')
    if (observed.length > 0) {
      const count = observed.length
      const action = new vscode.CodeAction(
        `RailsForge: ${count} AI hint${count === 1 ? '' : 's'} observed for ${label}`,
        REFACTORING_ACTION_KIND,
      )
      action.command = { command: REVIEW_AI_HINTS_COMMAND, title: `Review AI hints for ${label}`, arguments: [document.uri, range] }
      return [action]
    }

    const suggestions = engine.recommendations(relativePath, content, target).filter(r => r.confidence !== 'low')
    if (suggestions.length === 0) {return []}

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
