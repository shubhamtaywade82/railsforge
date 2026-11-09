/**
 * RefactoringPrompts - the prompts the advisor sends. Pure string assembly; the instructions here are
 * the contract the parsers in ResponseParsers.ts enforce.
 *
 * Two prompts: a refinement prompt that asks the model to decide on static findings, and a plan
 * prompt that asks for a unified diff over the files a recommendation touches.
 */

import type { Candidate, RefactorTarget } from './types'
import { describeScope, ADVISOR_LIMITS } from './types'
import type { AdvisorContext } from './RefactoringContextBuilder'
import { clip } from './RefactoringContextBuilder'
import type { Technique } from '../patterns/TechniqueCatalog'
import { ADVISOR_ALLOWED_ROOTS } from '../planning/PathGuard'

export const ADVISOR_SYSTEM_PROMPT = [
  'You are the RailsForge Refactoring Advisor for Ruby on Rails applications.',
  'You are given findings that static analysis already measured. Decide on those findings; never invent a new problem.',
  'Recommend a change only when it removes a concrete cost visible in the code. A simpler design beats a pattern that adds indirection without a need.',
  'Keep behaviour identical unless the recommendation says otherwise. Answer in exactly the format the user message requests, with no extra prose.',
].join('\n')

/** One finding plus the techniques that passed their validators for it. */
export interface FindingView {
  candidate: Candidate
  valid: readonly Technique[]
  rejected: ReadonlyArray<{ name: string; reason: string }>
}

export function buildRefinePrompt(input: {
  path: string
  scope: RefactorTarget
  findings: readonly FindingView[]
  context: AdvisorContext
  patternNames: readonly string[]
}): string {
  const { path, scope, findings, context, patternNames } = input
  const lines: string[] = [
    `Review the STATIC FINDINGS below for ${describeScope(scope)} in ${path}.`,
    'For each finding, decide one of:',
    '- "recommend": choose ONE technique from that finding\'s allowed list (use its id exactly) and explain the design, the trade-offs and what to verify.',
    '- "skip": the current code is already appropriate. Give the reason. Skipping is a correct answer.',
    '',
    'Rules:',
    '- Justify the choice with the measured facts in the finding. A pattern is never recommended only because a finding exists.',
    '- List alternatives, including keeping the current code, and say when each would be better.',
    `- Only list files from CONTEXT, or new .rb files whose path starts with ${ADVISOR_ALLOWED_ROOTS.join(', ')}.`,
    '- Benefit, risk and verification must name this code, not generic advice.',
    `- Return at most ${ADVISOR_LIMITS.maxRecommendations} "recommend" decisions.`,
    '',
    `Pattern vocabulary for the project: ${patternNames.join(', ') || 'none supplied'}.`,
    '',
    'Output: one JSON object and nothing else:',
    '{"decisions":[{"candidateId":"c1","decision":"recommend|skip","technique":"<allowed id>","reason":"...",' +
      '"design":"...","benefit":"...","risk":"...","alternatives":[{"name":"...","whenBetter":"..."}],' +
      '"affectedFiles":["..."],"steps":["..."],"verification":["..."]}]}',
    '',
    'STATIC FINDINGS:',
  ]

  for (const view of findings) {
    const c = view.candidate
    lines.push(`- ${c.id} [${c.kind}, ${c.strength} rule, severity ${c.severity}] ${c.headline}`)
    for (const e of c.evidence) {lines.push(`    evidence: lines ${e.startLine}-${e.endLine}: ${e.note}`)}
    lines.push(`    allowed techniques: ${view.valid.map(t => `${t.id} (${t.name})`).join(', ')}`)
    for (const r of view.rejected) {lines.push(`    considered and rejected: ${r.name}: ${r.reason}`)}
  }

  lines.push('', `TARGET (${describeScope(scope)}, lines ${scope.startLine}-${scope.endLine}):`, '```ruby', scope.text, '```', '', 'CONTEXT:')
  lines.push(...renderContext(context))
  return lines.join('\n')
}

export interface PlanBrief {
  title: string
  technique: string
  design: string
  steps: readonly string[]
  files: ReadonlyArray<{ path: string; before: string | undefined }>
}

export function buildPlanPrompt(brief: PlanBrief): string {
  const lines: string[] = [
    `Apply this refactoring: ${brief.title} (technique: ${brief.technique}).`,
    `Design: ${brief.design}`,
  ]
  if (brief.steps.length > 0) {
    lines.push('Steps:', ...brief.steps.map((step, i) => `${i + 1}. ${step}`))
  }
  lines.push(
    '',
    'Output ONLY a unified diff (git format; a ```diff fence is allowed) that changes the files listed below. Rules:',
    `- Every file gets "--- a/<path>" and "+++ b/<path>" headers. Only these paths may appear: ${brief.files.map(f => f.path).join(', ')}.`,
    '- A file that does not exist yet uses "--- /dev/null" and "+++ b/<path>", with one "@@ -0,0 +1,N @@" hunk containing only + lines.',
    '- Context lines (leading space) and removed lines (leading -) must match the CURRENT file text below exactly, including indentation. Give three lines of context per hunk.',
    '- Keep public method names, signatures and return values unchanged unless the recommendation says otherwise, and keep the existing specs passing.',
    '- Preserve transactions, callbacks and the order of side effects. Do not add comments that describe the refactoring itself.',
    '- Output nothing except the diff.',
    '',
    'CURRENT FILES:',
  )
  for (const file of brief.files) {
    lines.push(`=== ${file.path} ===`)
    if (file.before === undefined) {lines.push('(does not exist yet)')}
    else {lines.push('```ruby', file.before, '```')}
  }
  return lines.join('\n')
}

/** Appended to the original prompt when the previous answer was rejected. */
export function buildRepairSuffix(reason: string, previousAnswer: string): string {
  return [
    '',
    `Your previous answer was rejected: ${reason}`,
    'Answer again in the exact requested format.',
    'Your previous answer, for reference (do not repeat its mistake):',
    clip(previousAnswer, 1_500),
  ].join('\n')
}

function renderContext(context: AdvisorContext): string[] {
  const out: string[] = []
  out.push(`### Primary file: ${context.primaryPath}`)
  if (context.primarySource !== undefined) {out.push('```ruby', context.primarySource, '```')}
  else {out.push('(too large to include whole; the TARGET above is the part under review)')}

  for (const item of context.related) {
    out.push(`### Related: ${item.path} (defines ${item.referencedAs.join(', ')})`, '```ruby', item.excerpt, '```')
  }
  for (const spec of context.specs) {
    out.push(`### Spec for the primary file: ${spec.path}`, '```ruby', spec.excerpt, '```')
  }
  if (context.callers.length > 0) {
    out.push(`### Callers (files that depend on ${context.primaryPath}): ${context.callers.join(', ')}`)
  }
  if (context.conventions.length > 0) {
    out.push('### Existing pattern instances in this project (match their conventions):')
    for (const convention of context.conventions) {out.push(`- ${convention}`)}
  }
  return out
}
