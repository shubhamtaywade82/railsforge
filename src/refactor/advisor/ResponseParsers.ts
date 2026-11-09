/**
 * ResponseParsers - turns raw model text into validated values. Nothing downstream sees model text
 * directly.
 *
 *   - Suggestions come back as one JSON object (small, structured, easy to validate with zod).
 *   - Code changes come back as a unified diff (scales with the change, not the file size, so a
 *     rewrite of a large class does not exceed the output budget). Reuses the strict parser the
 *     existing fix flow uses.
 */

import { z } from 'zod'
import { parseUnifiedDiff, UnifiedHunk } from '../../patch/UnifiedDiff'

export interface RawSuggestion {
  title: string
  pattern: string
  principle?: string
  impact: 'low' | 'medium' | 'high'
  rationale: string
  files: string[]
  steps: string[]
}

const suggestionSchema = z.object({
  title: z.string().trim().min(3),
  pattern: z.string().trim().min(2),
  principle: z.string().trim().optional(),
  impact: z.string().optional(),
  rationale: z.string().trim().min(10),
  files: z.array(z.string().trim().min(1)).min(1),
  steps: z.array(z.string().trim()).optional(),
})

const adviceSchema = z.object({
  suggestions: z.array(suggestionSchema),
})

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string }

/** Parses a suggestion answer. An empty list is valid: it means the target is already well designed. */
export function parseAdvice(text: string): ParseResult<RawSuggestion[]> {
  const json = extractJsonObject(text)
  if (!json.ok) {return json}

  const parsed = adviceSchema.safeParse(json.value)
  if (!parsed.success) {
    return { ok: false, message: `The answer did not match the required shape: ${summarizeIssues(parsed.error.issues)}.` }
  }

  return {
    ok: true,
    value: parsed.data.suggestions.map(s => ({
      title: s.title,
      pattern: s.pattern,
      principle: s.principle || undefined,
      impact: normalizeImpact(s.impact),
      rationale: s.rationale,
      files: s.files,
      steps: s.steps ?? [],
    })),
  }
}

/**
 * Extracts the first unified diff from a model answer and parses it. Blank lines inside a hunk are
 * read as empty context lines (models drop the leading space on them), trailing blank lines are
 * dropped, and a fenced ```diff block is preferred over surrounding prose.
 */
export function parseCodeDiff(text: string): UnifiedHunk[] | null {
  let body = text
  for (const fenced of text.matchAll(/```(?:diff|patch)?[ \t]*\r?\n([\s\S]*?)```/g)) {
    if (/^@@ /m.test(fenced[1])) {
      body = fenced[1]
      break
    }
  }

  const lines = body.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n')
  let inHunk = false
  const normalized = lines.map(line => {
    if (line.startsWith('@@ ')) {inHunk = true; return line}
    if (inHunk && line === '') {return ' '}
    return line
  })
  return parseUnifiedDiff(normalized.join('\n'))
}

/**
 * Finds the first balanced JSON object in model text. Tolerates a ```json fence and surrounding
 * prose, which small local models add despite instructions.
 */
export function extractJsonObject(text: string): ParseResult<unknown> {
  const fenced = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/.exec(text)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return { ok: false, message: 'The answer contained no JSON object.' }
  }
  try {
    return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)) as unknown }
  } catch (err) {
    return { ok: false, message: `The answer was not valid JSON (${err instanceof Error ? err.message : String(err)}).` }
  }
}

function normalizeImpact(value: string | undefined): 'low' | 'medium' | 'high' {
  const v = (value ?? '').trim().toLowerCase()
  if (v === 'low' || v === 'high') {return v}
  return 'medium'
}

function summarizeIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues.slice(0, 3)
    .map(issue => `${issue.path.map(String).join('.') || 'root'}: ${issue.message}`)
    .join('; ')
}
