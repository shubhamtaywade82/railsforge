/**
 * BackgroundHints - the opt-in, on-save AI review (`railsForge.refactoring.aiHints: "on-save"`).
 *
 * Off by default: it sends code to the configured AI provider without a request from the developer.
 * When on:
 *
 *   - a save is debounced per document (a burst of saves to one file is one review);
 *   - a review that is due is queued, never dropped: saving another file while a review runs queues
 *     that file, and the queue is processed one review at a time, in arrival order. A document saved
 *     again while it is queued is reviewed once, with its newest text;
 *   - each review looks at one scope: the highest-ranked scope with a measured finding whose stored
 *     observation is missing or stale (its own text or its context fingerprint changed).
 */

import * as vscode from 'vscode'
import { Logger } from '../../util/Logger'
import { RefactoringAdvisor } from '../core/RefactoringAdvisor'
import { RefactoringEngine } from '../core/RefactoringEngine'
import { chooseBackgroundScope, ObservationStore, recordRefinement, scopeText } from '../core/ObservationStore'
import { describeScope, RefactorTarget, ScopeRef } from '../core/types'

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
  /** Documents waiting for a review, by URI. A document queued twice keeps only its newest copy. */
  private readonly pending = new Map<string, vscode.TextDocument>()
  private busy = false
  private readonly idleWaiters: Array<() => void> = []

  constructor(private readonly deps: BackgroundHintsDeps) {}

  onDidSave(document: vscode.TextDocument): void {
    if (!this.deps.enabled() || document.languageId !== 'ruby') {return}
    if (!this.deps.pathOf(document.uri)) {return}

    const key = document.uri.toString()
    const debounced = this.timers.get(key)
    if (debounced) {clearTimeout(debounced)}
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key)
      this.enqueue(document)
    }, this.deps.debounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS))
  }

  /** Queues a review of the document. It runs now if nothing else is running, otherwise after the queue ahead of it. */
  enqueue(document: vscode.TextDocument): void {
    this.pending.set(document.uri.toString(), document)
    if (!this.busy) {void this.drain()}
  }

  /** Resolves once every queued review has finished. */
  whenIdle(): Promise<void> {
    if (!this.busy && this.pending.size === 0) {return Promise.resolve()}
    return new Promise(resolve => this.idleWaiters.push(resolve))
  }

  dispose(): void {
    for (const timer of this.timers.values()) {clearTimeout(timer)}
    this.timers.clear()
    this.pending.clear()
  }

  private async drain(): Promise<void> {
    this.busy = true
    try {
      while (this.pending.size > 0) {
        const [key, document] = this.pending.entries().next().value as [string, vscode.TextDocument]
        this.pending.delete(key)
        await this.reviewOne(document)
      }
    } finally {
      // Synchronous with the loop's last check: nothing can be queued between the two.
      this.busy = false
      for (const resolve of this.idleWaiters.splice(0)) {resolve()}
    }
  }

  private async reviewOne(document: vscode.TextDocument): Promise<void> {
    if (!this.deps.enabled()) {return}
    const path = this.deps.pathOf(document.uri)
    if (!path) {return}

    const { engine, observations, advisor } = this.deps
    const content = document.getText()
    const fingerprint = (scope: ScopeRef) => advisor.fingerprint(path, content, scope)
    const ranked = engine.allRecommendations(path, content).filter(r => r.confidence !== 'low')
    const scope = await chooseBackgroundScope(path, content, ranked, observations, fingerprint)
    if (!scope) {return}

    try {
      const target: RefactorTarget = { ...scope, text: scopeText(content, scope) }
      const candidates = engine.candidatesIn(path, content, scope)
      const refined = await advisor.refine({ path, content, scope: target, candidates })
      if (refined.ok) {
        await recordRefinement(observations, path, content, scope, refined.value.recommendations, refined.value.skipped, fingerprint)
        Logger.info(`[Refactoring] background review of ${describeScope(scope)}: ${refined.value.recommendations.length} hint(s) observed`)
      } else {
        Logger.warn(`[Refactoring] background review of ${describeScope(scope)} not observed: ${refined.reason}`)
      }
    } catch (err) {
      Logger.warn(`[Refactoring] background review failed: ${String(err)}`)
    }
  }
}
