/**
 * Pure workspace-root resolution (no vscode dependency, unit-testable).
 * A file belongs to the deepest workspace folder that contains it, which also
 * handles nested folders in a multi-root workspace.
 */

import * as path from 'path'

export function isInside(root: string, filePath: string): boolean {
  const rel = path.relative(root, filePath)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Deepest root containing `filePath`, or undefined if none does. */
export function resolveWorkspaceRoot(filePath: string | undefined, roots: readonly string[]): string | undefined {
  if (!filePath) {return undefined}
  let best: string | undefined
  for (const root of roots) {
    if (isInside(root, filePath) && (best === undefined || root.length > best.length)) {
      best = root
    }
  }
  return best
}
