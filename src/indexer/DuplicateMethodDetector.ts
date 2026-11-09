/**
 * DuplicateMethodDetector - Phase 8: near-duplicate method detection across the whole
 * indexed codebase (not just within one file, unlike the line-count-only SRP/DRY
 * heuristics DesignPrincipleLinter already had). Backed by the `methods` table's
 * pre-tokenized bodies (see PersistentIndexer), so this is a fast in-memory comparison
 * over already-parsed data rather than re-parsing anything.
 */

import { SqliteDatabase } from './database'

export interface DuplicateMethodSite {
  name: string
  filePath: string
  startLine: number
  endLine: number
}

export interface DuplicateMethodPair {
  a: DuplicateMethodSite
  b: DuplicateMethodSite
  similarity: number
}

interface MethodRow {
  name: string
  file_path: string
  start_line: number
  end_line: number
  normalized_body: string
  body_tokens: string
}

export class DuplicateMethodDetector {
  constructor(private db: SqliteDatabase) {}

  /**
   * @param minLines Methods shorter than this are skipped — trivial one-liners
   *   (`def call; end`-style) match everything and aren't useful DRY signal.
   * @param threshold Jaccard similarity (0-1) above which two methods count as duplicates.
   */
  findDuplicates(minLines = 4, threshold = 0.75): DuplicateMethodPair[] {
    const rows = this.db
      .prepare('SELECT name, file_path, start_line, end_line, normalized_body, body_tokens FROM methods')
      .all() as MethodRow[]

    const candidates = rows
      .map(r => ({ ...r, lineCount: r.normalized_body.split('\n').filter(Boolean).length, tokens: new Set<string>(JSON.parse(r.body_tokens)) }))
      .filter(r => r.lineCount >= minLines && r.tokens.size > 0)

    const pairs: DuplicateMethodPair[] = []
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i]
        const b = candidates[j]
        if (a.file_path === b.file_path && a.start_line === b.start_line) {continue}

        // Jaccard(a, b) <= min(|a|, |b|) / max(|a|, |b|). A pair whose sizes are too far apart cannot
        // reach the threshold, so skip it before building the intersection. This never drops a pair
        // that would have passed.
        const lo = Math.min(a.tokens.size, b.tokens.size)
        const hi = Math.max(a.tokens.size, b.tokens.size)
        if (lo < threshold * hi) {continue}

        const similarity = jaccard(a.tokens, b.tokens)
        if (similarity >= threshold) {
          pairs.push({
            a: { name: a.name, filePath: a.file_path, startLine: a.start_line, endLine: a.end_line },
            b: { name: b.name, filePath: b.file_path, startLine: b.start_line, endLine: b.end_line },
            similarity,
          })
        }
      }
    }

    return pairs.sort((x, y) => y.similarity - x.similarity)
  }

  /** Duplicates involving a specific file, for surfacing as diagnostics while editing. */
  findDuplicatesForFile(filePath: string, minLines = 4, threshold = 0.75): DuplicateMethodPair[] {
    return this.findDuplicates(minLines, threshold).filter(p => p.a.filePath === filePath || p.b.filePath === filePath)
  }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) {intersection++}
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}
