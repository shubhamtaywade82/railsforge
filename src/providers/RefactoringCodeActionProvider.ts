/**
 * RefactoringCodeActionProvider - the lightbulb for refactoring hints.
 *
 * Precedence for the cursor's scope (the same rule as the CodeLens, see core/HintPrecedence):
 *   observed  the AI hints observed for the scope, or for scopes inside it     -> review them (no model call)
 *   reviewed  the AI reviewed the scope and found nothing to change there     -> shows the reasons
 *   rules     medium or high confidence rule-based findings                   -> asks the AI when chosen
 *
 * Producing the action never calls a model.
 */

import * as vscode from 'vscode'
import { REVIEW_AI_HINTS_COMMAND, SUGGEST_REFACTORINGS_COMMAND } from '../refactoring-intelligence/vscode/RefactoringCommand'
import { RefactoringEngine } from '../refactoring-intelligence/core/RefactoringEngine'
import { hintsWithin, ObservationStore, ScopeFingerprint } from '../refactoring-intelligence/core/ObservationStore'
import { describeTarget, TargetResolver } from '../refactoring-intelligence/core/ScopeResolver'
import type { ScopeRef } from '../refactoring-intelligence/core/types'
import { toSelectionLines } from '../refactoring-intelligence/vscode/workspacePaths'

export const REFACTORING_ACTION_KIND = vscode.CodeActionKind.Refactor.append('railsforge.advisor')

export interface RefactoringCodeActionDeps {
  engine: RefactoringEngine
  resolver: TargetResolver
  observations: ObservationStore
  fingerprint: (path: string, content: string, scope: ScopeRef) => Promise<string>
  /** Workspace-relative path of a document, or undefined when it is outside the project. */
  pathOf: (uri: vscode.Uri) => string | undefined
}

export class RefactoringCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [REFACTORING_ACTION_KIND]

  constructor(private readonly deps: RefactoringCodeActionDeps) {}

  async provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection): Promise<vscode.CodeAction[]> {
    if (document.languageId !== 'ruby') {return []}
    const relativePath = this.deps.pathOf(document.uri)
    if (!relativePath) {return []}

    const { engine, resolver, observations, fingerprint } = this.deps
    const content = document.getText()
    const resolution = resolver.resolve(content, toSelectionLines(range))
    if (!resolution.ok) {return []}
    const target = resolution.target
    const label = describeTarget(target)
    const fingerprintOf: ScopeFingerprint = scope => fingerprint(relativePath, content, scope)

    const within = await hintsWithin(observations, relativePath, content, engine.scopes(content), target, fingerprintOf)
    if (within.observed.length > 0) {
      const count = within.observed.length
      return [reviewAction(document, range, `RailsForge: ${count} AI hint${count === 1 ? '' : 's'} observed for ${label}`, label)]
    }
    if (within.reviewed) {
      return [reviewAction(document, range, `RailsForge: AI reviewed ${label}: nothing to change`, label)]
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

function reviewAction(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, title: string, label: string): vscode.CodeAction {
  const action = new vscode.CodeAction(title, REFACTORING_ACTION_KIND)
  action.command = { command: REVIEW_AI_HINTS_COMMAND, title: `Review AI hints for ${label}`, arguments: [document.uri, range] }
  return action
}
