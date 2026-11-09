/**
 * ObservationStore - AI hints kept after the request that produced them.
 *
 * An AI review is paid for once. Its recommendations are stored per scope (a class, a method or a
 * block) together with a hash of that scope's text. A stored observation is shown in the CodeLens and
 * the lightbulb only while the scope's text is unchanged, so an edit elsewhere in the file does not
 * hide a still-valid hint, and an edit inside the scope does.
 *
 * Observations are keyed by name, not line number, so moving a method does not invalidate it.
 * Storing "the AI looked and found nothing" (an empty list) is distinct from "never looked" (undefined),
 * so a background review does not ask again about code that has not changed.
 *
 * This module is pure: persistence is injected by the host through `onDidChange`.
 */

import { createHash } from 'crypto'
import type { Recommendation, ScopeRef } from './types'

export const MAX_OBSERVED_SCOPES = 100

export interface ObservedScope {
  key: string
  path: string
  scope: ScopeRef
  scopeHash: string
  recommendations: Recommendation[]
  observedAt: number
}

export interface ObservationSnapshot {
  version: 1
  entries: ObservedScope[]
}

/** Stable identity of a scope: file, kind, owner and name. Line numbers are deliberately excluded. */
export function scopeKey(path: string, scope: Pick<ScopeRef, 'kind' | 'name' | 'className'>): string {
  return `${path}#${scope.kind}:${scope.className ?? ''}:${scope.name}`
}

/** The text of the lines a scope covers (1-based, inclusive). */
export function scopeText(content: string, scope: Pick<ScopeRef, 'startLine' | 'endLine'>): string {
  return content.split(/\r?\n/).slice(Math.max(0, scope.startLine - 1), Math.max(0, scope.endLine)).join('\n')
}

export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export class ObservationStore {
  private readonly entries = new Map<string, ObservedScope>()
  private readonly listeners: Array<() => void> = []

  constructor(
    snapshot?: ObservationSnapshot,
    private readonly limit: number = MAX_OBSERVED_SCOPES,
  ) {
    if (snapshot && snapshot.version === 1 && Array.isArray(snapshot.entries)) {
      for (const entry of snapshot.entries) {
        if (typeof entry?.key === 'string' && typeof entry.scopeHash === 'string' && Array.isArray(entry.recommendations)) {
          this.entries.set(entry.key, entry)
        }
      }
      this.prune()
    }
  }

  /** Subscribes to changes. Returns the unsubscribe function. */
  onDidChange(listener: () => void): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) {this.listeners.splice(index, 1)}
    }
  }

  put(path: string, scope: ScopeRef, text: string, recommendations: readonly Recommendation[], now: number = Date.now()): void {
    const key = scopeKey(path, scope)
    this.entries.delete(key)
    this.entries.set(key, {
      key,
      path,
      scope: { kind: scope.kind, name: scope.name, className: scope.className, startLine: scope.startLine, endLine: scope.endLine },
      scopeHash: textHash(text),
      recommendations: [...recommendations],
      observedAt: now,
    })
    this.prune()
    this.emit()
  }

  /**
   * The observation for a scope, if one exists and the scope's text is unchanged since. `undefined`
   * means "not observed, or changed since"; an empty array means "observed, nothing to recommend".
   */
  get(path: string, scope: Pick<ScopeRef, 'kind' | 'name' | 'className'>, text: string): Recommendation[] | undefined {
    const entry = this.entries.get(scopeKey(path, scope))
    if (!entry || entry.scopeHash !== textHash(text)) {return undefined}
    return entry.recommendations
  }

  snapshot(): ObservationSnapshot {
    return { version: 1, entries: [...this.entries.values()] }
  }

  private prune(): void {
    while (this.entries.size > this.limit) {
      let oldest: ObservedScope | undefined
      for (const entry of this.entries.values()) {
        if (!oldest || entry.observedAt < oldest.observedAt) {oldest = entry}
      }
      if (!oldest) {break}
      this.entries.delete(oldest.key)
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {listener()}
  }
}

/**
 * Stores the outcome of one AI review: each recommendation under its own scope, and an empty
 * observation for the reviewed target when the AI recommended nothing there, so it is not asked again.
 */
export function recordRefinement(
  store: ObservationStore,
  path: string,
  content: string,
  target: ScopeRef,
  recommendations: readonly Recommendation[],
): void {
  const groups = new Map<string, { scope: ScopeRef; recommendations: Recommendation[] }>()
  for (const rec of recommendations) {
    const key = scopeKey(path, rec.scope)
    const group = groups.get(key) ?? { scope: rec.scope, recommendations: [] }
    group.recommendations.push(rec)
    groups.set(key, group)
  }
  if (!groups.has(scopeKey(path, target))) {
    store.put(path, target, scopeText(content, target), [])
  }
  for (const group of groups.values()) {
    store.put(path, group.scope, scopeText(content, group.scope), group.recommendations)
  }
}

/** Observed recommendations for one scope, or none when the scope is unobserved or has changed. */
export function observedFor(store: ObservationStore, path: string, content: string, scope: ScopeRef): Recommendation[] {
  return store.get(path, scope, scopeText(content, scope)) ?? []
}

/**
 * Observed recommendations for a target and every scope it contains (a class includes its methods).
 * Each scope is looked up once; a recommendation belongs to exactly one scope, so nothing repeats.
 */
export function observedWithin(
  store: ObservationStore,
  path: string,
  content: string,
  scopes: readonly ScopeRef[],
  target: ScopeRef,
): Recommendation[] {
  const seen = new Set<string>([scopeKey(path, target)])
  const out: Recommendation[] = [...observedFor(store, path, content, target)]
  for (const scope of scopes) {
    const key = scopeKey(path, scope)
    if (seen.has(key)) {continue}
    if (scope.startLine < target.startLine || scope.endLine > target.endLine) {continue}
    seen.add(key)
    out.push(...observedFor(store, path, content, scope))
  }
  return out
}

/**
 * The next scope a background review should look at: the highest-ranked scope with a recommendation
 * that has no observation for its current text. Returns undefined when every such scope is observed.
 * `ranked` must be in priority order (RefactoringEngine.allRecommendations is).
 */
export function chooseBackgroundScope(
  path: string,
  content: string,
  ranked: readonly Recommendation[],
  store: ObservationStore,
): ScopeRef | undefined {
  for (const rec of ranked) {
    if (store.get(path, rec.scope, scopeText(content, rec.scope)) === undefined) {return rec.scope}
  }
  return undefined
}
