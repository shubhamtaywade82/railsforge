/**
 * Line-based diff/patch helpers shared by the AI fix flow and the chat diff applier.
 * Pure (no vscode import) so they are unit-tested directly.
 */

export interface LineDiffHunk {
  startLine: number
  removedCount: number
  inserted: string[]
}

/** Line-based diff (LCS) between two texts; returns non-overlapping hunks that transform `oldText` into `newText`. */
export function diffLines(oldText: string, newText: string): LineDiffHunk[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const m = oldLines.length
  const n = newLines.length

  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = oldLines[i] === newLines[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const hunks: LineDiffHunk[] = []
  let i = 0
  let j = 0
  let open: LineDiffHunk | null = null
  const flush = (): void => {
    if (open && (open.removedCount > 0 || open.inserted.length > 0)) {hunks.push(open)}
    open = null
  }
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      flush()
      i++
      j++
      continue
    }
    if (!open) {open = { startLine: i, removedCount: 0, inserted: [] }}
    if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      open.removedCount++
      i++
    } else {
      open.inserted.push(newLines[j])
      j++
    }
  }
  if (open) {
    open.removedCount += m - i
    open.inserted.push(...newLines.slice(j))
    flush()
  } else if (i < m || j < n) {
    hunks.push({ startLine: i, removedCount: m - i, inserted: newLines.slice(j) })
  }
  return hunks
}

/**
 * Keeps only hunks that overlap the reported diagnostic range (0-based lines).
 * Hunks outside it are the model's unrelated edits (reformatting, renames,
 * whole-file rewrites) and must never be applied — that's what makes an AI fix
 * minimal instead of a noisy rewrite.
 */
export function filterFixHunks(hunks: LineDiffHunk[], range: { startLine: number; endLine: number }): { keep: LineDiffHunk[]; skipped: number } {
  const keep: LineDiffHunk[] = []
  let skipped = 0
  for (const h of hunks) {
    const hunkEnd = h.startLine + Math.max(h.removedCount, 1) - 1
    if (h.startLine <= range.endLine && hunkEnd >= range.startLine) {keep.push(h)}
    else {skipped++}
  }
  return { keep, skipped }
}

/**
 * Applies hunks to `fullText` and returns the resulting text. Lossless: applying
 * `diffLines(a, b)` to `a` always yields `b`, so the applied result is exactly
 * what the reviewer saw in the diff preview.
 */
export function applyHunks(fullText: string, hunks: LineDiffHunk[]): string {
  const lines = fullText.split('\n')
  const out: string[] = []
  let cursor = 0
  for (const h of hunks) {
    out.push(...lines.slice(cursor, h.startLine))
    out.push(...h.inserted)
    cursor = h.startLine + h.removedCount
  }
  out.push(...lines.slice(cursor))
  return out.join('\n')
}
