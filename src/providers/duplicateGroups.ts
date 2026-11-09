/**
 * duplicateGroups - converts the detector's pairs into the SemanticIndex's group shape.
 *
 * Pure: no vscode import, so it is unit tested directly. Paths become workspace-relative with forward
 * slashes, the convention `relativeTo` uses for editor paths. Sites outside the analysed root are
 * dropped, because the refactoring advisor only reads files under its root.
 */

import * as path from 'path'
import type { DuplicateMethodPair, DuplicateMethodSite } from '../indexer/DuplicateMethodDetector'
import type { DuplicateMethodGroup } from './SemanticIndex'

export function toDuplicateGroups(pairs: readonly DuplicateMethodPair[], root: string): DuplicateMethodGroup[] {
  const groups: DuplicateMethodGroup[] = []
  for (const pair of pairs) {
    const a = occurrenceOf(pair.a, root)
    const b = occurrenceOf(pair.b, root)
    if (!a || !b) {continue}
    const fingerprint = [a, b]
      .map(o => `${o.relativePath}:${o.lineStart}-${o.lineEnd}`)
      .sort()
      .join('|')
    groups.push({ fingerprint, similarity: pair.similarity, occurrences: [a, b] })
  }
  return groups
}

function occurrenceOf(site: DuplicateMethodSite, root: string): DuplicateMethodGroup['occurrences'][number] | undefined {
  const relative = path.relative(root, site.filePath)
  if (relative === '' || path.isAbsolute(relative) || relative.split(path.sep)[0] === '..') {return undefined}
  return {
    relativePath: relative.split(path.sep).join('/'),
    lineStart: site.startLine,
    lineEnd: site.endLine,
    methodName: site.name,
  }
}
