/**
 * HintPrecedence - decides what a scope shows, in one place, for the CodeLens and the lightbulb alike.
 *
 *   1. observed    the AI's current recommendations for the scope (medium and high confidence only)
 *   2. reviewed    the AI looked at the scope and recommended nothing there; its reasons are kept
 *   3. rules       the deterministic findings (medium and high confidence only)
 *   4. none
 *
 * A low-confidence AI recommendation never takes the observed slot, so it cannot hide a stronger
 * rule-based finding. Keeping the rule for this in one function is what stops the CodeLens and the
 * lightbulb from drifting apart.
 */

import type { ObservedScope } from './ObservationStore'
import type { Recommendation } from './types'

export type ScopeHint =
  | { kind: 'observed'; recommendations: Recommendation[] }
  | { kind: 'reviewed'; reasons: string[] }
  | { kind: 'rules'; recommendations: Recommendation[] }
  | { kind: 'none' }

export function resolveScopeHint(observation: ObservedScope | undefined, rules: readonly Recommendation[]): ScopeHint {
  const visible = (observation?.recommendations ?? []).filter(r => r.confidence !== 'low')
  if (visible.length > 0) {return { kind: 'observed', recommendations: visible }}
  if (observation && observation.recommendations.length === 0) {return { kind: 'reviewed', reasons: observation.reasons }}

  const rulesVisible = rules.filter(r => r.confidence !== 'low')
  if (rulesVisible.length > 0) {return { kind: 'rules', recommendations: rulesVisible }}
  return { kind: 'none' }
}
