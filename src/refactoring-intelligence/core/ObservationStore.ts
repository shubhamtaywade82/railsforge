/**
 * ObservationStore - AI hints kept after the request that produced them.
 *
 * An AI review is paid for once. Its outcome is stored per scope (a class, a method or a block) with
 * two keys:
 *
 *   - the scope's own text hash: an edit inside the scope invalidates its observation;
 *   - a context fingerprint: a hash of the inputs the advice depends on outside the scope (the
 *     definitions of constants it references, its spec, its callers, the project's conventions).
 *     A change to any of them invalidates the observation, so architectural advice is never shown
 *     against code it no longer describes.
 *
 * A stored observation is in one of two states, and absence is a third:
 *
 *   unobserved                       no entry, or an entry whose keys no longer match
 *   observed_with_recommendations    the AI proposed at least one recommendation
 *   observed_without_recommendations the AI looked and proposed nothing; its skip reasons are kept
 *
 * Observations are keyed by name, not line number, so moving a method does not invalidate it.
 *
 * This module is pure. Persistence is injected by the host through `onDidChange`; the fingerprint is
 * injected by the caller, so the store never reads files.
 */

import { createHash } from 'crypto'
import type { Recommendation, ScopeRef } from './types'

export const MAX_OBSERVED_SCOPES = 100

export type ObservationState = 'observed_with_recommendations' | 'observed_without_recommendations'

export interface ObservedScope {
  key: string
  path: string
  scope: ScopeRef
  /** Hash of the scope's own text when the observation was recorded. */
  scopeHash: string
  /** Hash of the context the advice depends on, when the observation was recorded. */
  fingerprint: string
  /** Every recommendation, including low confidence ones; the caller decides what is shown. */
  recommendations: Recommendation[]
  /** Why the AI declined the candidates it did not recommend (kept with the scope). */
  reasons: string[]
  observedAt: number
}

export interface ObservationSnapshot {
  version: 1
  entries: ObservedScope[]
}

/** Computes the context fingerprint for one scope of the current document. Injected by the host. */
export type ScopeFingerprint = (scope: ScopeRef) => Promise<string>

export function observationStateOf(entry: ObservedScope): ObservationState {
  return entry.recommendations.length > 0 ? 'observed_with_recommendations' : 'observed_without_recommendations'
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
        if (typeof entry?.key === 'string' && typeof entry.scopeHash === 'string'
          && typeof entry.fingerprint === 'string' && Array.isArray(entry.recommendations)) {
          this.entries.set(entry.key, { ...entry, reasons: Array.isArray(entry.reasons) ? entry.reasons : [] })
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

  put(
    path: string,
    scope: ScopeRef,
    text: string,
    fingerprint: string,
    recommendations: readonly Recommendation[],
    reasons: readonly string[] = [],
    now: number = Date.now(),
  ): void {
    const key = scopeKey(path, scope)
    this.entries.delete(key)
    this.entries.set(key, {
      key,
      path,
      scope: { kind: scope.kind, name: scope.name, className: scope.className, startLine: scope.startLine, endLine: scope.endLine },
      scopeHash: textHash(text),
      fingerprint,
      recommendations: [...recommendations],
      reasons: [...reasons],
      observedAt: now,
    })
    this.prune()
    this.emit()
  }

  /**
   * The stored entry for a scope whose own text is unchanged. It does not check the context
   * fingerprint: use `currentObservation`, which does.
   */
  peek(path: string, scope: Pick<ScopeRef, 'kind' | 'name' | 'className'>, text: string): ObservedScope | undefined {
    const entry = this.entries.get(scopeKey(path, scope))
    if (!entry || entry.scopeHash !== textHash(text)) {return undefined}
    return entry
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
 * The observation for a scope, only if both its own text and its context fingerprint still match.
 * Undefined means "unobserved" (never reviewed, or stale for either reason).
 */
export async function currentObservation(
  store: ObservationStore,
  path: string,
  content: string,
  scope: ScopeRef,
  fingerprint: ScopeFingerprint,
): Promise<ObservedScope | undefined> {
  const entry = store.peek(path, scope, scopeText(content, scope))
  if (!entry) {return undefined}
  return (await fingerprint(scope)) === entry.fingerprint ? entry : undefined
}

/**
 * Stores the outcome of one AI review. Each recommendation goes under its own scope. The reviewed
 * target always gets an entry, so a review that recommended nothing there is remembered, together
 * with the reasons the AI gave for skipping.
 */
export async function recordRefinement(
  store: ObservationStore,
  path: string,
  content: string,
  target: ScopeRef,
  recommendations: readonly Recommendation[],
  skipped: ReadonlyArray<{ reason: string }>,
  fingerprint: ScopeFingerprint,
): Promise<void> {
  const groups = new Map<string, { scope: ScopeRef; recommendations: Recommendation[] }>()
  for (const rec of recommendations) {
    const key = scopeKey(path, rec.scope)
    const group = groups.get(key) ?? { scope: rec.scope, recommendations: [] }
    group.recommendations.push(rec)
    groups.set(key, group)
  }
  const reasons = skipped.map(s => s.reason)

  if (!groups.has(scopeKey(path, target))) {
    store.put(path, target, scopeText(content, target), await fingerprint(target), [], reasons)
  }
  for (const group of groups.values()) {
    const reasonsHere = scopeKey(path, group.scope) === scopeKey(path, target) ? reasons : []
    store.put(path, group.scope, scopeText(content, group.scope), await fingerprint(group.scope), group.recommendations, reasonsHere)
  }
}

export interface HintsWithin {
  /** Visible (non-low) AI recommendations for the target and every scope inside it. */
  observed: Recommendation[]
  /** Set when the AI reviewed the target itself and recommended nothing there: its skip reasons. */
  reviewed?: string[]
}

/**
 * What the AI has observed for a target: its own observation, plus every observation for a scope
 * inside it (a class includes its methods). Each scope is looked up once.
 */
export async function hintsWithin(
  store: ObservationStore,
  path: string,
  content: string,
  scopes: readonly ScopeRef[],
  target: ScopeRef,
  fingerprint: ScopeFingerprint,
): Promise<HintsWithin> {
  const own = await currentObservation(store, path, content, target, fingerprint)
  const observed: Recommendation[] = (own?.recommendations ?? []).filter(r => r.confidence !== 'low')
  const seen = new Set<string>([scopeKey(path, target)])
  for (const scope of scopes) {
    const key = scopeKey(path, scope)
    if (seen.has(key)) {continue}
    if (scope.startLine < target.startLine || scope.endLine > target.endLine) {continue}
    seen.add(key)
    const entry = await currentObservation(store, path, content, scope, fingerprint)
    if (entry) {observed.push(...entry.recommendations.filter(r => r.confidence !== 'low'))}
  }
  const reviewed = own && own.recommendations.length === 0 ? own.reasons : undefined
  return reviewed === undefined ? { observed } : { observed, reviewed }
}

/**
 * The next scope a background review should look at: the highest-ranked scope with a recommendation
 * that has no current observation (none, or one that went stale). Undefined when all are current.
 * `ranked` must be in priority order (RefactoringEngine.allRecommendations is).
 */
export async function chooseBackgroundScope(
  path: string,
  content: string,
  ranked: readonly Recommendation[],
  store: ObservationStore,
  fingerprint: ScopeFingerprint,
): Promise<ScopeRef | undefined> {
  for (const rec of ranked) {
    if (!(await currentObservation(store, path, content, rec.scope, fingerprint))) {return rec.scope}
  }
  return undefined
}
