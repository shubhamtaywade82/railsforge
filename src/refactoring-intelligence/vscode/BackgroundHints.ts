/**
 * BackgroundHints - the opt-in, on-save AI review (`railsForge.refactoring.aiHints: "on-save"`).
 *
 * Off by default: it sends code to the configured AI provider without a request from the developer.
 * When on, each save reviews at most one scope: the highest-ranked scope with a measured finding whose
 * current text has no observation yet. A scope whose text has not changed is never asked about again.
 * Only one review runs at a time, and saves are debounced, so a burst of saves costs one request.
 */

import * as vscode from 'vscode'
import { Logger } from '../../util/Logger'
import { RefactoringAdvisor } from '../core/RefactoringAdvisor'
import { RefactoringEngine } from '../core/RefactoringEngine'
import { chooseBackgroundScope, ObservationStore, recordRefinement, scopeText } from '../core/ObservationStore'
import { describeScope, RefactorTarget } from '../core/types'

export const DEFAULT_SAVE_DEBOUNCE_MS = 2_000

export interface BackgroundHintsDeps {
  engine: RefactoringEngine
  advisor: RefactoringAdvisor
  observations: ObservationStore
  /** Workspace-relative path of a document, or undefined when it is outside the project. */
  pathOf: (uri: vscode.Uri) => string | undefined
  enabled: () => boolean
  debounceMs?: number
}

export class BackgroundHints implements vscode.Disposable {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private busy = false

  constructor(private readonly deps: BackgroundHintsDeps) {}

  onDidSave(document: vscode.TextDocument): void {
    if (!this.deps.enabled() || document.languageId !== 'ruby') {return}
    if (!this.deps.pathOf(document.uri)) {return}

    const key = document.uri.toString()
    const pending = this.timers.get(key)
    if (pending) {clearTimeout(pending)}
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key)
      void this.review(document)
    }, this.deps.debounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS))
  }

  /** Reviews the next unobserved scope in one document. Exposed for tests and for the timer. */
  async review(document: vscode.TextDocument): Promise<void> {
    if (this.busy || !this.deps.enabled()) {return}
    const path = this.deps.pathOf(document.uri)
    if (!path) {return}

    const { engine, observations, advisor } = this.deps
    const content = document.getText()
    const ranked = engine.allRecommendations(path, content).filter(r => r.confidence !== 'low')
    const scope = chooseBackgroundScope(path, content, ranked, observations)
    if (!scope) {return}

    this.busy = true
    try {
      const target: RefactorTarget = { ...scope, text: scopeText(content, scope) }
      const candidates = engine.candidatesIn(path, content, scope)
      const refined = await advisor.refine({ path, content, scope: target, candidates })
      if (refined.ok) {
        recordRefinement(observations, path, content, scope, refined.value.recommendations)
        Logger.info(`[Refactoring] background review of ${describeScope(scope)}: ${refined.value.recommendations.length} hint(s) observed`)
      } else {
        Logger.warn(`[Refactoring] background review of ${describeScope(scope)} not observed: ${refined.reason}`)
      }
    } catch (err) {
      Logger.warn(`[Refactoring] background review failed: ${String(err)}`)
    } finally {
      this.busy = false
    }
  }

  dispose(): void {
    for (const timer of this.timers.values()) {clearTimeout(timer)}
    this.timers.clear()
  }
}
