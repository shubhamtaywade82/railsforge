/**
 * ResponseParsers - turns raw model text into validated values. Nothing downstream sees model text.
 *
 *   - Refinement decisions come back as one JSON object (small and structured; validated with zod).
 *   - Code changes come back as a unified diff (scales with the change, not the file size). Reuses
 *     the strict parser the existing fix flow uses.
 *
 * Semantic checks (does the candidate exist? is the technique allowed for it?) happen in
 * RefactoringAdvisor, where the candidates are known. These parsers only check shape.
 */

import { z } from 'zod'
import { parseUnifiedDiff, UnifiedHunk } from '../../patch/UnifiedDiff'

export interface RawDecision {
  candidateId: string
  decision: 'recommend' | 'skip'
  technique?: string
  reason?: string
  design?: string
  benefit?: string
  risk?: string
  alternatives: Array<{ name: string; whenBetter: string }>
  affectedFiles: string[]
  steps: string[]
  verification: string[]
}

const decisionSchema = z.object({
  candidateId: z.string().trim().min(1),
  decision: z.string().optional(),
  technique: z.string().trim().optional(),
  reason: z.string().trim().optional(),
  design: z.string().trim().optional(),
  benefit: z.string().trim().optional(),
  risk: z.string().trim().optional(),
  alternatives: z.array(z.object({ name: z.string().trim().min(1), whenBetter: z.string().trim().optional() })).optional(),
  affectedFiles: z.array(z.string().trim().min(1)).optional(),
  steps: z.array(z.string().trim().min(1)).optional(),
  verification: z.array(z.string().trim().min(1)).optional(),
})

const refinementSchema = z.object({
  decisions: z.array(decisionSchema),
})

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string }

export function parseRefinement(text: string): ParseResult<RawDecision[]> {
  const json = extractJsonObject(text)
  if (!json.ok) {return json}

  const parsed = refinementSchema.safeParse(json.value)
  if (!parsed.success) {
    return { ok: false, message: `The answer did not match the required shape: ${summarizeIssues(parsed.error.issues)}.` }
  }

  return {
    ok: true,
    value: parsed.data.decisions.map(d => ({
      candidateId: d.candidateId,
      decision: normalizeDecision(d.decision),
      technique: d.technique || undefined,
      reason: d.reason || undefined,
      design: d.design || undefined,
      benefit: d.benefit || undefined,
      risk: d.risk || undefined,
      alternatives: (d.alternatives ?? []).map(a => ({ name: a.name, whenBetter: a.whenBetter ?? '' })),
      affectedFiles: d.affectedFiles ?? [],
      steps: d.steps ?? [],
      verification: d.verification ?? [],
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

function normalizeDecision(value: string | undefined): 'recommend' | 'skip' {
  return (value ?? '').trim().toLowerCase() === 'skip' ? 'skip' : 'recommend'
}

function summarizeIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues.slice(0, 3)
    .map(issue => `${issue.path.map(String).join('.') || 'root'}: ${issue.message}`)
    .join('; ')
}
