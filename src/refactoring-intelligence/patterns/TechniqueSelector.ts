/**
 * TechniqueSelector - which techniques apply to a candidate, and which were considered and rejected.
 *
 * Rejected techniques are kept with their reasons. A recommendation can then say "Strategy was
 * considered and rejected: only 2 branches", which is the alternatives-and-trade-offs explanation the
 * developer needs, and it keeps the advisor from recommending a pattern without evidence.
 */

import type { Candidate } from '../core/types'
import { Technique, TECHNIQUES, techniqueById } from './TechniqueCatalog'

export interface TechniqueSelection {
  valid: Technique[]
  rejected: Array<{ technique: Technique; reason: string }>
}

/**
 * The alternatives a reviewer should see next to a chosen technique: other validated techniques (with
 * the condition under which each would be better), techniques that were rejected here (with the reason),
 * techniques the catalog names as alternatives but that were not validated, and keeping the code.
 */
export function alternativesFor(
  selection: TechniqueSelection,
  chosen: Technique,
): Array<{ name: string; whenBetter: string }> {
  const out: Array<{ name: string; whenBetter: string }> = []
  const named = new Set<string>([chosen.id])

  for (const technique of selection.valid) {
    if (named.has(technique.id)) {continue}
    named.add(technique.id)
    out.push({ name: technique.name, whenBetter: technique.whenToUse[0] ?? technique.intent })
  }
  for (const rejected of selection.rejected) {
    if (named.has(rejected.technique.id)) {continue}
    named.add(rejected.technique.id)
    out.push({ name: rejected.technique.name, whenBetter: `considered and rejected: ${rejected.reason}` })
  }
  for (const id of chosen.alternatives) {
    const technique = techniqueById(id)
    if (!technique || named.has(id)) {continue}
    named.add(id)
    out.push({ name: technique.name, whenBetter: `${technique.whenToUse[0] ?? technique.intent} Not validated for this code.` })
  }
  out.push({ name: 'Keep the current code', whenBetter: chosen.avoidWhen.join(' ') })
  return out
}

export function selectTechniques(candidate: Candidate, catalog: readonly Technique[] = TECHNIQUES): TechniqueSelection {
  const valid: Technique[] = []
  const rejected: TechniqueSelection['rejected'] = []
  for (const technique of catalog) {
    if (!technique.appliesTo.includes(candidate.kind)) {continue}
    const verdict = technique.validate(candidate)
    if (verdict.ok) {valid.push(technique)}
    else {rejected.push({ technique, reason: verdict.reason })}
  }
  return { valid, rejected }
}
