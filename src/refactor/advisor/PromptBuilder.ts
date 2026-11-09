/**
 * PromptBuilder - the prompts the advisor sends. Pure string assembly; the instructions here are the
 * contract the parsers in ResponseParsers.ts enforce.
 */

import { AdvisorContext, clip } from './ContextBuilder'
import { ADVISOR_LIMITS, RefactorSuggestion, RefactorTarget } from './types'
import { describeTarget } from './TargetResolver'
import { ADVISOR_ALLOWED_ROOTS } from './PathGuard'

export const ADVISOR_SYSTEM_PROMPT = [
  'You are the RailsForge refactoring advisor for Ruby on Rails applications.',
  'Recommend only changes that remove a concrete problem visible in the code you were given: single responsibility, duplication, Law of Demeter, hard-wired collaborators, or departures from Rails conventions.',
  'Name the design pattern you apply (for example Service Object, Query Object, Form Object, Value Object, Strategy, Decorator, Concern, Policy, Factory Method, Command, Template Method) and the principle it serves.',
  'Never invent methods, classes, files or behavior that the provided code does not show. Keep behavior identical unless the suggestion explicitly says otherwise.',
  'Answer in exactly the format the user message requests, with no extra prose.',
].join('\n')

export function buildAdvicePrompt(input: {
  relativePath: string
  target: RefactorTarget
  context: AdvisorContext
  patternNames: readonly string[]
}): string {
  const { relativePath, target, context, patternNames } = input
  const lines: string[] = []

  lines.push(
    `Suggest up to ${ADVISOR_LIMITS.maxSuggestions} refactorings for the TARGET below, in file ${relativePath}.`,
    'Each suggestion must:',
    '- name one concrete design pattern or best-practice change and the principle it serves;',
    '- list in "files" the workspace files it changes: files from CONTEXT, or NEW files whose path starts with ' +
      `${ADVISOR_ALLOWED_ROOTS.join(', ')} and ends with .rb;`,
    '- explain in "rationale" the specific problem in the code (two or three sentences that cite the code);',
    '- set "impact" to low, medium or high, judged by how many files and call sites the change touches.',
    'Prefer a few sharp suggestions to many generic ones. If the target is already well designed, return an empty list.',
    '',
    `Pattern vocabulary (use these names when they fit): ${patternNames.join(', ') || 'none supplied'}.`,
  )

  if (context.conventions.length > 0) {
    lines.push('Existing pattern instances in this project (match their conventions when you propose new ones):')
    for (const convention of context.conventions) {lines.push(`- ${convention}`)}
  }

  lines.push(
    '',
    'Output: one JSON object and nothing else, in this shape:',
    '{"suggestions":[{"title":"...","pattern":"...","principle":"...","impact":"low|medium|high",' +
      '"rationale":"...","files":["..."],"steps":["..."]}]}',
    '',
    `TARGET (${describeTarget(target)}, lines ${target.startLine}-${target.endLine}):`,
    '```ruby',
    target.text,
    '```',
    '',
    'CONTEXT:',
  )
  lines.push(...renderContext(context))

  return lines.join('\n')
}

export function buildPlanPrompt(input: {
  suggestion: RefactorSuggestion
  files: ReadonlyArray<{ path: string; before: string | undefined }>
}): string {
  const { suggestion, files } = input
  const lines: string[] = [
    `Apply this refactoring: ${suggestion.title} (pattern: ${suggestion.pattern}).`,
    `Rationale: ${suggestion.rationale}`,
  ]
  if (suggestion.steps.length > 0) {
    lines.push('Steps:', ...suggestion.steps.map((step, i) => `${i + 1}. ${step}`))
  }
  lines.push(
    '',
    'Output ONLY a unified diff (git format; a ```diff fence is allowed) that changes the files listed below. Rules:',
    `- Every file gets "--- a/<path>" and "+++ b/<path>" headers. Only these paths may appear: ${files.map(f => f.path).join(', ')}.`,
    '- A file that does not exist yet uses "--- /dev/null" and "+++ b/<path>", with one "@@ -0,0 +1,N @@" hunk containing only + lines.',
    '- Context lines (leading space) and removed lines (leading -) must match the CURRENT file text below exactly, including indentation. Give three lines of context per hunk.',
    '- Keep public method names, signatures and return values unchanged unless the suggestion says otherwise, and keep the existing specs passing.',
    '- Do not add comments that describe the refactoring itself. Output nothing except the diff.',
    '',
    'CURRENT FILES:',
  )
  for (const file of files) {
    lines.push(`=== ${file.path} ===`)
    if (file.before === undefined) {
      lines.push('(does not exist yet)')
    } else {
      lines.push('```ruby', file.before, '```')
    }
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
  if (context.primarySource !== undefined) {
    out.push('```ruby', context.primarySource, '```')
  } else {
    out.push('(too large to include whole; the TARGET above is the part under review)')
  }

  for (const item of context.related) {
    out.push(`### Related: ${item.path} (defines ${item.referencedAs.join(', ')})`, '```ruby', item.excerpt, '```')
  }
  for (const spec of context.specs) {
    out.push(`### Spec for the primary file: ${spec.path}`, '```ruby', spec.excerpt, '```')
  }
  if (context.callers.length > 0) {
    out.push(`### Callers (files that depend on ${context.primaryPath}): ${context.callers.join(', ')}`)
  }
  return out
}
