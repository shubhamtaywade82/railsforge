/**
 * PrincipleFindingsAdapter - turns findings from the existing design-principle linter into candidates.
 *
 * The linter already owns these heuristics (SRP, Law of Demeter, YAGNI). This adapter does not
 * re-implement them; it lifts their findings into the same candidate contract, so the technique
 * validators and the recommendation contract treat them like every other candidate. Findings the
 * advisor has no technique for are dropped rather than presented without a recommendation.
 */

import { AnalysisInput, CandidateDraft, draft, evidenceAt, methodSites } from './AnalysisContext'
import type { CandidateKind } from '../core/types'

const PRINCIPLE_KINDS: Record<string, CandidateKind> = {
  'SRP-FAT-CLASS': 'principle.srp-fat-class',
  'DEMETER-VIOLATION': 'principle.demeter',
  'YAGNI-UNUSED-PRIVATE': 'principle.yagni-unused-private',
}

export function analyzePrinciples(input: AnalysisInput): CandidateDraft[] {
  const out: CandidateDraft[] = []
  for (const finding of input.principleFindings ?? []) {
    const kind = PRINCIPLE_KINDS[finding.id]
    if (!kind) {continue}
    const endLine = Math.max(finding.line, finding.endLine ?? finding.line)
    const enclosing = methodSites(input).find(s => finding.line >= s.method.startLine && finding.line <= s.method.endLine)
    const classOwner = input.types.find(t => finding.line >= t.startLine && finding.line <= t.endLine)
    const anchor = kind === 'principle.srp-fat-class' ? 'class' : enclosing ? 'method' : 'block'
    out.push(draft(kind, input, {
      startLine: anchor === 'class' && classOwner ? classOwner.startLine : finding.line,
      endLine: anchor === 'class' && classOwner ? classOwner.endLine : endLine,
      anchor,
      className: (classOwner ?? enclosing?.type)?.name,
      methodName: enclosing?.method.name,
      headline: `${finding.title}: ${finding.message}`,
      strength: 'moderate',
      severity: finding.severity <= 1 ? 2 : 1,
      metrics: { principleId: finding.id },
      evidence: [evidenceAt(input.path, finding.line, endLine, finding.title)],
    }))
  }
  return out
}
