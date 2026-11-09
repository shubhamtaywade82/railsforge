/**
 * RefactoringCodeLensProvider - shows refactoring hints above the classes, methods and loops where
 * they apply. What a scope shows follows the precedence in core/HintPrecedence, the same rule the
 * lightbulb uses:
 *
 *   observed  "✦ AI: 2 hints observed"               (click reviews them, no model call)
 *   reviewed  "✦ AI reviewed: nothing to change"     (click shows the AI's reasons)
 *   rules     "✦ RailsForge: 1 refactoring opportunity" (click asks the AI)
 *
 * An observation counts only while its own text and its context fingerprint still match (see
 * core/ObservationStore). The lens is refreshed when observations change and can be turned off with
 * `railsForge.refactoring.codeLens`.
 */

import * as vscode from 'vscode'
import { REVIEW_AI_HINTS_COMMAND, SUGGEST_REFACTORINGS_COMMAND } from '../refactoring-intelligence/vscode/RefactoringCommand'
import { RefactoringEngine } from '../refactoring-intelligence/core/RefactoringEngine'
import { currentObservation, ObservationStore, ScopeFingerprint } from '../refactoring-intelligence/core/ObservationStore'
import { resolveScopeHint, ScopeHint } from '../refactoring-intelligence/core/HintPrecedence'
import type { Recommendation, ScopeRef } from '../refactoring-intelligence/core/types'

export interface RefactoringCodeLensDeps {
  engine: RefactoringEngine
  observations: ObservationStore
  /** Context fingerprint of one scope of the given document (see RefactoringAdvisor.fingerprint). */
  fingerprint: (path: string, content: string, scope: ScopeRef) => Promise<string>
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

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (!this.deps.enabled() || document.languageId !== 'ruby') {return []}
    const relativePath = this.deps.pathOf(document.uri)
    if (!relativePath) {return []}

    const { engine, observations, fingerprint } = this.deps
    const content = document.getText()
    const fingerprintOf: ScopeFingerprint = scope => fingerprint(relativePath, content, scope)
    const rules = engine.allRecommendations(relativePath, content)
    const lenses: vscode.CodeLens[] = []

    for (const scope of engine.scopes(content)) {
      const observation = await currentObservation(observations, relativePath, content, scope, fingerprintOf)
      const anchored = rules.filter(r => r.scope.kind === scope.kind && r.scope.startLine === scope.startLine)
      lenses.push(...lensFor(document, scope, resolveScopeHint(observation, anchored)))
    }

    const blocks = new Map<string, ScopeRef>()
    for (const rec of rules) {
      if (rec.scope.kind === 'block') {blocks.set(`${rec.scope.startLine}:${rec.scope.endLine}`, rec.scope)}
    }
    for (const block of blocks.values()) {
      const observation = await currentObservation(observations, relativePath, content, block, fingerprintOf)
      const anchored = rules.filter(r => r.scope.kind === 'block' && r.scope.startLine === block.startLine)
      lenses.push(...lensFor(document, block, resolveScopeHint(observation, anchored)))
    }
    return lenses
  }
}

function lensFor(document: vscode.TextDocument, scope: ScopeRef, hint: ScopeHint): vscode.CodeLens[] {
  switch (hint.kind) {
    case 'observed': {
      const count = hint.recommendations.length
      return [new vscode.CodeLens(lineRange(scope.startLine), {
        title: `✦ AI: ${count} hint${count === 1 ? '' : 's'} observed · ${hint.recommendations[0].priority}`,
        command: REVIEW_AI_HINTS_COMMAND,
        arguments: [document.uri, lineSpan(scope)],
      })]
    }
    case 'reviewed':
      return [new vscode.CodeLens(lineRange(scope.startLine), {
        title: '✦ AI reviewed: nothing to change at this level',
        command: REVIEW_AI_HINTS_COMMAND,
        arguments: [document.uri, lineSpan(scope)],
      })]
    case 'rules':
      return [ruleLens(document, scope.startLine, scope.endLine, hint.recommendations)]
    case 'none':
      return []
  }
}

function ruleLens(document: vscode.TextDocument, startLine: number, endLine: number, recommendations: readonly Recommendation[]): vscode.CodeLens {
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
