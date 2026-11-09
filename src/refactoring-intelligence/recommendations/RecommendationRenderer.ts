/**
 * RecommendationRenderer - the recommendation contract as a reviewable document.
 *
 * Section order follows the contract: problem, evidence, design, alternatives, benefit, risk, affected
 * files, verification. The source is shown so a reviewer can tell rule-based output from AI-refined output.
 */

import { describeScope, Recommendation } from '../core/types'

export function renderRecommendation(rec: Recommendation): string {
  const source = rec.source === 'ai'
    ? 'AI-refined from measured findings'
    : 'rule-based (no AI call)'
  const lines: string[] = [
    `# ${rec.title}`,
    '',
    `**Priority:** ${rec.priority} · **Confidence:** ${rec.confidence} · **Source:** ${source}`,
    '',
    `**Scope:** ${describeScope(rec.scope)} in \`${rec.path}\``,
    '',
    '> **Next Step:** Click the **"Preview change"** button in the notification popup (bottom-right) to generate side-by-side diffs and apply this refactoring.',
    '',
    '## Problem',
    rec.problem,
    '',
    '## Evidence',
    ...rec.evidence.map(e => `- \`${e.path}\` lines ${e.startLine}-${e.endLine}: ${e.note}`),
    '',
    '## Recommended design',
    `**Technique:** ${rec.technique?.name ?? 'none'}`,
    '',
    rec.design,
    '',
    '## Alternatives',
    ...rec.alternatives.map(a => `- **${a.name}**: ${a.whenBetter}`),
    '',
    '## Benefit',
    rec.benefit,
    '',
    '## Risk',
    rec.risk,
    '',
    '## Affected files',
    ...rec.affectedFiles.map(f => `- \`${f}\``),
    '',
    '## Steps',
    ...rec.steps.map((step, i) => `${i + 1}. ${step}`),
    '',
    '## Verification',
    ...rec.verification.map(v => `- ${v}`),
    '',
  ]
  return lines.join('\n')
}
