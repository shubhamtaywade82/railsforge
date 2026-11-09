/**
 * CrossFileDuplicates - turns the index's duplicate groups into the entries one file needs.
 *
 * The engine analyses one file at a time. For that file this produces, per method, the other copies
 * in other files. Pure: no vscode import and no dependency on the providers layer; the structural type
 * below is what the host passes in.
 */

export interface IndexedDuplicateOccurrence {
  relativePath: string
  lineStart: number
  lineEnd: number
  methodName: string
}

export interface IndexedDuplicateGroup {
  similarity?: number
  occurrences: ReadonlyArray<IndexedDuplicateOccurrence>
}

/** One method in the analysed file, paired with one copy of it in another file, as indexed at last save. */
export interface CrossFileDuplicate {
  lineStart: number
  lineEnd: number
  methodName: string
  otherPath: string
  otherLineStart: number
  otherLineEnd: number
  otherMethodName: string
  similarity: number
}

export function crossFileDuplicatesFor(groups: readonly IndexedDuplicateGroup[], relativePath: string): CrossFileDuplicate[] {
  const out: CrossFileDuplicate[] = []
  for (const group of groups) {
    const own = group.occurrences.filter(o => o.relativePath === relativePath)
    if (own.length === 0) {continue}
    const others = group.occurrences.filter(o => o.relativePath !== relativePath)
    for (const mine of own) {
      for (const other of others) {
        out.push({
          lineStart: mine.lineStart,
          lineEnd: mine.lineEnd,
          methodName: mine.methodName,
          otherPath: other.relativePath,
          otherLineStart: other.lineStart,
          otherLineEnd: other.lineEnd,
          otherMethodName: other.methodName,
          similarity: group.similarity ?? 0,
        })
      }
    }
  }
  return out
}
