/**
 * CrossFileDuplicationAnalyzer - a method in this file whose body the index found in other files.
 *
 * The index is written at save time, so a copy may have moved, been renamed or been edited since. A
 * finding is raised only when this file's current parse still shows the same method at the same lines
 * under the same name. Partner files are re-read by the advisor before any change is proposed.
 *
 * All partners of one method become one candidate. The collector keeps one candidate per kind and
 * line range, so separate candidates would drop every partner after the first.
 */

import type { CrossFileDuplicate } from '../core/CrossFileDuplicates'
import { AnalysisInput, CandidateDraft, draft, evidenceAt, methodSites } from './AnalysisContext'

/** Token overlap at or above this is strong evidence that the copies are the same workflow. */
export const STRONG_CROSS_FILE_SIMILARITY = 0.9

export function analyzeCrossFileDuplicates(input: AnalysisInput, duplicates: readonly CrossFileDuplicate[]): CandidateDraft[] {
  const byMethod = new Map<string, CrossFileDuplicate[]>()
  for (const dup of duplicates) {
    const key = `${dup.lineStart}:${dup.lineEnd}:${dup.methodName}`
    const list = byMethod.get(key) ?? []
    list.push(dup)
    byMethod.set(key, list)
  }

  const out: CandidateDraft[] = []
  for (const partners of byMethod.values()) {
    const first = partners[0]
    const site = methodSites(input).find(
      s => s.method.startLine === first.lineStart && s.method.endLine === first.lineEnd && s.method.name === first.methodName,
    )
    if (!site) {continue} // Stale index entry: the method moved, was renamed or was edited since the last save.

    const best = Math.max(...partners.map(p => p.similarity))
    const partnerPaths = [...new Set(partners.map(p => p.otherPath))].sort()
    const where = partnerPaths.length === 1 ? partnerPaths[0] : `${partnerPaths.length} other files`
    out.push(draft('duplicate.cross-file', input, {
      startLine: site.method.startLine,
      endLine: site.method.endLine,
      anchor: 'method',
      className: site.type.name,
      methodName: site.method.name,
      headline: `${site.method.name} repeats logic from ${where} (up to ${Math.round(best * 100)}% token overlap)`,
      strength: best >= STRONG_CROSS_FILE_SIMILARITY ? 'strong' : 'moderate',
      severity: 2,
      metrics: {
        duplicateOf: partners.map(p => `${p.otherPath}:${p.otherLineStart}-${p.otherLineEnd} ${p.otherMethodName}`),
        partnerPaths,
      },
      evidence: [
        evidenceAt(input.path, site.method.startLine, site.method.endLine, `${site.method.name} (this file)`),
        ...partners.map(p => evidenceAt(
          p.otherPath,
          p.otherLineStart,
          p.otherLineEnd,
          `${p.otherMethodName} (${Math.round(p.similarity * 100)}% overlap at last save)`,
        )),
      ],
    }))
  }
  return out
}
