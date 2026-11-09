/**
 * ChangePlanner - turns a model's unified diff into exact file contents, and proves they are safe to show.
 *
 * Every rule here is a rejection, not a warning:
 *   - every hunk names a file the recommendation listed, inside the allowed roots (PathGuard);
 *   - hunks apply to the CURRENT text (context and removed lines must match, with bounded line drift);
 *   - a new file is created only from `--- /dev/null`, and an existing file is never recreated;
 *   - the diff must change something;
 *   - every changed file must parse as Ruby, when a Ruby interpreter is available.
 *
 * Nothing is written here. The caller shows the proposed contents and applies them after approval.
 */

import { applyUnifiedHunks, UnifiedHunk } from '../../patch/UnifiedDiff'
import { parseCodeDiff } from '../core/ResponseParsers'
import type { AdvisorResult, ProposedChange, ProposedPlan, SyntaxVerdict } from '../core/types'
import { checkAdvisorPath } from './PathGuard'

export interface PlannedFile {
  path: string
  before: string | undefined
}

export async function validateDiffPlan(
  text: string,
  files: readonly PlannedFile[],
  checkSyntax: (code: string) => Promise<SyntaxVerdict>,
): Promise<AdvisorResult<ProposedPlan>> {
  const hunks = parseCodeDiff(text)
  if (!hunks) {
    return {
      ok: false,
      reason: 'invalid-response',
      message: 'The answer contained no valid unified diff. Output only a unified diff with --- and +++ headers and @@ hunks.',
    }
  }

  const allowed = new Set(files.map(f => f.path))
  const byPath = new Map<string, UnifiedHunk[]>()
  for (const hunk of hunks) {
    if (hunk.file === null) {
      return { ok: false, reason: 'invalid-response', message: 'A hunk has no "+++ b/<path>" header.' }
    }
    const guard = checkAdvisorPath(hunk.file)
    if (!guard.ok) {return { ok: false, reason: 'unsafe-path', message: guard.message }}
    if (!allowed.has(guard.path)) {
      return {
        ok: false,
        reason: 'file-not-allowed',
        message: `${guard.path} is not one of the files this recommendation may change (${[...allowed].join(', ')}).`,
      }
    }
    const list = byPath.get(guard.path) ?? []
    list.push(hunk)
    byPath.set(guard.path, list)
  }

  const changes: ProposedChange[] = []
  for (const file of files) {
    const fileHunks = byPath.get(file.path)
    if (!fileHunks) {continue}

    if (file.before === undefined) {
      if (fileHunks.some(h => h.oldLines.length > 0)) {
        return {
          ok: false,
          reason: 'file-missing',
          message: `${file.path} does not exist yet, so its hunks may only add lines (use --- /dev/null).`,
        }
      }
      const after = fileHunks.flatMap(h => h.newLines).join('\n') + '\n'
      if (after.trim() === '') {
        return { ok: false, reason: 'invalid-response', message: `${file.path} would be created empty.` }
      }
      changes.push({ path: file.path, kind: 'create', before: undefined, after })
      continue
    }

    if (fileHunks.some(h => h.oldLines.length === 0)) {
      // Every hunk without old lines is a "create this file" diff aimed at a file that already exists.
      const creating = fileHunks.every(h => h.oldLines.length === 0)
      return creating
        ? {
          ok: false,
          reason: 'file-exists',
          message: `${file.path} already exists. Change it with context and removed lines copied from its current text, not with --- /dev/null.`,
        }
        : {
          ok: false,
          reason: 'hunk-mismatch',
          message: `A hunk for ${file.path} has no context lines. Include three unchanged lines around each change, copied from CURRENT FILES.`,
        }
    }

    const applied = applyUnifiedHunks(file.before, fileHunks)
    if (!applied.ok) {
      return {
        ok: false,
        reason: 'hunk-mismatch',
        message: `${file.path}: ${applied.reason}. Copy context and removed lines exactly from CURRENT FILES.`,
      }
    }
    if (applied.text === file.before) {continue}
    changes.push({ path: file.path, kind: 'modify', before: file.before, after: applied.text })
  }

  if (changes.length === 0) {
    return { ok: false, reason: 'no-change', message: 'The diff does not change any file.' }
  }

  let syntaxUnverified = false
  for (const change of changes) {
    const verdict = await checkSyntax(change.after)
    if (verdict.status === 'error') {
      return {
        ok: false,
        reason: 'syntax-error',
        message: `${change.path} would not parse as Ruby: ${firstLine(verdict.message)}. Fix the diff so every changed file is valid Ruby.`,
      }
    }
    if (verdict.status === 'unavailable') {syntaxUnverified = true}
  }
  return { ok: true, value: { changes, syntaxUnverified } }
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trim().slice(0, 300)
}
