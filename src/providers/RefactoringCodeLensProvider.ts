/**
 * RefactoringCodeLensProvider - shows refactoring hints above the classes, methods and loops where
 * they apply.
 *
 * Three kinds of lens, in order of precedence for each scope:
 *   1. AI hints observed for the scope's current text: "✦ AI: 2 hints observed". Clicking reviews them.
 *      No model call.
 *   2. The AI reviewed the scope and recommended nothing: "✦ AI reviewed: no change recommended".
 *   3. Rule-based findings only: "✦ RailsForge: 1 refactoring opportunity". Clicking asks the AI.
 *
 * Only medium and high confidence items are shown. The lens is refreshed when observations change, and
 * it can be turned off with `railsForge.refactoring.codeLens`.
 */

import * as vscode from 'vscode'
import { REVIEW_AI_HINTS_COMMAND, SUGGEST_REFACTORINGS_COMMAND } from '../refactoring-intelligence/vscode/RefactoringCommand'
import { RefactoringEngine } from '../refactoring-intelligence/core/RefactoringEngine'
import { observedFor, ObservationStore, scopeText } from '../refactoring-intelligence/core/ObservationStore'
import type { Recommendation, ScopeRef } from '../refactoring-intelligence/core/types'

export interface RefactoringCodeLensDeps {
  engine: RefactoringEngine
  observations: ObservationStore
  /** Workspace-relative path of a document, or undefined when it is outside the project. */
  pathOf: (uri: vscode.Uri) => string | undefined
  enabled: () => boolean
}

export class RefactoringCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeCodeLenses = this.changed.event

  constructor(private readonly deps: RefactoringCodeLensDeps) {}

  /** Asks VS Code to request lenses again, for example after an observation was recorded. */
  refresh(): void {
    this.changed.fire()
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.deps.enabled() || document.languageId !== 'ruby') {return []}
    const relativePath = this.deps.pathOf(document.uri)
    if (!relativePath) {return []}

    const { engine, observations } = this.deps
    const content = document.getText()
    const visible = engine.allRecommendations(relativePath, content).filter(r => r.confidence !== 'low')
    const lenses: vscode.CodeLens[] = []

    for (const scope of engine.scopes(content)) {
      const observed = observations.get(relativePath, scope, scopeText(content, scope))
      if (observed !== undefined) {
        const hints = observed.filter(r => r.confidence !== 'low')
        if (hints.length > 0) {lenses.push(observedLens(document, scope, hints))}
        else if (observed.length === 0) {lenses.push(reviewedLens(document, scope))}
        continue
      }
      const anchored = visible.filter(r => r.scope.kind === scope.kind && r.scope.startLine === scope.startLine)
      if (anchored.length > 0) {lenses.push(ruleLens(document, scope.startLine, scope.endLine, anchored))}
    }

    for (const block of visible.filter(r => r.scope.kind === 'block')) {
      const hints = observedFor(observations, relativePath, content, block.scope).filter(r => r.confidence !== 'low')
      lenses.push(hints.length > 0 ? observedLens(document, block.scope, hints) : ruleLens(document, block.scope.startLine, block.scope.endLine, [block]))
    }
    return lenses
  }
}

function observedLens(document: vscode.TextDocument, scope: ScopeRef, hints: Recommendation[]): vscode.CodeLens {
  const count = hints.length
  return new vscode.CodeLens(lineRange(scope.startLine), {
    title: `✦ AI: ${count} hint${count === 1 ? '' : 's'} observed · ${hints[0].priority}`,
    command: REVIEW_AI_HINTS_COMMAND,
    arguments: [document.uri, lineSpan(scope)],
  })
}

function reviewedLens(document: vscode.TextDocument, scope: ScopeRef): vscode.CodeLens {
  return new vscode.CodeLens(lineRange(scope.startLine), {
    title: '✦ AI reviewed: nothing to change at this level',
    command: REVIEW_AI_HINTS_COMMAND,
    arguments: [document.uri, lineSpan(scope)],
  })
}

function ruleLens(document: vscode.TextDocument, startLine: number, endLine: number, recommendations: Recommendation[]): vscode.CodeLens {
  const count = recommendations.length
  return new vscode.CodeLens(lineRange(startLine), {
    title: `✦ RailsForge: ${count} refactoring ${count === 1 ? 'opportunity' : 'opportunities'} · ${recommendations[0].priority}`,
    command: SUGGEST_REFACTORINGS_COMMAND,
    arguments: [document.uri, new vscode.Range(startLine - 1, 0, endLine - 1, 0)],
  })
}

function lineRange(line: number): vscode.Range {
  return new vscode.Range(line - 1, 0, line - 1, 0)
}

function lineSpan(scope: ScopeRef): vscode.Range {
  return new vscode.Range(scope.startLine - 1, 0, scope.endLine - 1, 0)
}
