/**
 * RecommendationBuilder - turns candidates into ranked, deterministic recommendations.
 *
 * Every field is derived from measured facts and catalog text: priority from severity and rule
 * strength, confidence from rule strength and the amount of evidence, the design and trade-offs from
 * the technique that passed its validators. The AI refinement (RefactoringAdvisor.refine) can change
 * the wording and the file list, but it cannot change priority or confidence.
 */

import type { Candidate, Confidence, Priority, Recommendation, ScopeRef } from '../core/types'
import { ADVISOR_LIMITS } from '../core/types'
import { alternativesFor, selectTechniques } from '../patterns/TechniqueSelector'

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 }

export function priorityOf(candidate: Candidate): Priority {
  if (candidate.severity === 3) {return candidate.strength === 'strong' ? 'critical' : 'high'}
  if (candidate.severity === 2) {return candidate.strength === 'strong' ? 'high' : 'medium'}
  return 'low'
}

/**
 * Confidence follows the rule's strength and nothing else. More evidence lines do not make a heuristic
 * more certain: a moderate rule stays medium however many places it points at.
 */
export function confidenceOf(candidate: Candidate): Confidence {
  if (candidate.strength === 'strong') {return 'high'}
  if (candidate.strength === 'moderate') {return 'medium'}
  return 'low'
}

/** Candidates lying entirely inside the scope the developer selected. */
export function candidatesInScope(candidates: readonly Candidate[], scope: ScopeRef): Candidate[] {
  return candidates.filter(c => c.startLine >= scope.startLine && c.endLine <= scope.endLine)
}

export function scopeLabel(candidate: Candidate): string {
  const owner = candidate.methodName
    ? (candidate.className ? `${candidate.className}#${candidate.methodName}` : candidate.methodName)
    : undefined
  if (candidate.anchor === 'method' && owner) {return owner}
  if (candidate.anchor === 'class' && candidate.className) {return candidate.className}
  const lines = `lines ${candidate.startLine}-${candidate.endLine}`
  return owner ? `${lines} in ${owner}` : lines
}

/**
 * One recommendation per candidate that has at least one validated technique, using the best-fitting
 * technique. Ranked by priority, then confidence, then position; exact duplicates are removed.
 */
export function buildDeterministicRecommendations(
  candidates: readonly Candidate[],
  limit: number = ADVISOR_LIMITS.maxDeterministic,
): Recommendation[] {
  const built: Recommendation[] = []
  for (const candidate of candidates) {
    const selection = selectTechniques(candidate)
    const best = selection.valid[0]
    if (!best) {continue}
    const alternatives = alternativesFor(selection, best)

    built.push({
      id: '',
      source: 'deterministic',
      candidateIds: [candidate.id],
      path: candidate.path,
      scope: {
        kind: candidate.anchor,
        name: candidate.methodName ?? candidate.className ?? candidate.path,
        className: candidate.className,
        startLine: candidate.startLine,
        endLine: candidate.endLine,
      },
      title: `${best.name}: ${scopeLabel(candidate)}`,
      problem: candidate.headline,
      evidence: candidate.evidence,
      confidence: confidenceOf(candidate),
      priority: priorityOf(candidate),
      technique: { id: best.id, name: best.name },
      design: best.design(candidate),
      alternatives,
      benefit: best.benefit,
      risk: best.risk,
      affectedFiles: affectedFilesOf(candidate),
      steps: best.steps(candidate),
      verification: best.verification(candidate),
    })
  }
  return rank(built).slice(0, limit)
}

/**
 * Files a recommendation may change: the candidate's own file, then the partner files of a cross-file
 * duplicate. Capped at the advisor's file limit so a plan can never span more files than it can validate.
 */
export function affectedFilesOf(candidate: Candidate): string[] {
  const files = [candidate.path, ...(candidate.metrics.partnerPaths ?? [])]
  return [...new Set(files)].slice(0, ADVISOR_LIMITS.maxFilesPerRecommendation)
}

/** Sorts by priority, then confidence, then position; removes duplicates on (technique, path, start line). */
export function rank(recommendations: readonly Recommendation[]): Recommendation[] {
  const seen = new Set<string>()
  const unique = recommendations.filter(r => {
    const key = `${r.technique?.id ?? 'none'}:${r.path}:${r.scope.startLine}`
    if (seen.has(key)) {return false}
    seen.add(key)
    return true
  })
  unique.sort((a, b) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]
    || a.scope.startLine - b.scope.startLine)
  return unique.map((r, index) => ({ ...r, id: `r${index + 1}` }))
}
