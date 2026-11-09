/**
 * DuplicationAnalyzer - methods in the same file whose normalised bodies are identical.
 *
 * This analyzer is deliberately limited to what it can prove from one file. Copies in other files come
 * from the index and are handled by CrossFileDuplicationAnalyzer.
 */

import { AnalysisInput, CandidateDraft, draft, evidenceAt, methodSites, sliceLines } from './AnalysisContext'
import { codeLines, normalisedBody } from './metrics'

export const MIN_DUPLICATE_LINES = 3

export function analyzeDuplicates(input: AnalysisInput): CandidateDraft[] {
  const groups = new Map<string, Array<{ name: string; className: string; startLine: number; endLine: number }>>()
  for (const site of methodSites(input)) {
    // Compare the inside of the method only: the def line carries the name, which differs by design.
    const inner = sliceLines(input.lines, site.method.startLine + 1, site.method.endLine - 1)
    if (codeLines(inner).length < MIN_DUPLICATE_LINES) {continue}
    const key = normalisedBody(inner)
    const list = groups.get(key) ?? []
    list.push({ name: site.method.name, className: site.type.name, startLine: site.method.startLine, endLine: site.method.endLine })
    groups.set(key, list)
  }

  const out: CandidateDraft[] = []
  for (const members of groups.values()) {
    if (members.length < 2) {continue}
    const [first, ...rest] = members
    out.push(draft('method.duplicate', input, {
      startLine: first.startLine,
      endLine: first.endLine,
      anchor: 'method',
      className: first.className,
      methodName: first.name,
      headline: `${first.name} and ${rest.map(m => m.name).join(', ')} have identical bodies`,
      strength: 'strong',
      severity: 2,
      metrics: { duplicateOf: rest.map(m => m.name) },
      evidence: members.map(m => evidenceAt(input.path, m.startLine, m.endLine, `${m.name} (${m.endLine - m.startLine + 1} lines)`)),
    }))
  }
  return out
}
