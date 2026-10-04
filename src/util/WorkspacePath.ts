/**
 * Containment-checked path resolution for files written on behalf of AI output.
 *
 * Model-supplied paths ("```ruby:../../.ssh/config", absolute paths, symlinked
 * directories) must never escape the workspace root or touch VCS internals. This
 * module is vscode-free so the MCP server bundle and unit tests can use it.
 */

import * as fs from 'fs'
import * as path from 'path'

export type PathResolution =
  | { ok: true; fullPath: string; relative: string }
  | { ok: false; reason: string }

/** Directory names that AI-driven writes may never target. */
const DENIED_SEGMENTS = new Set(['.git'])

export interface ResolveOptions {
  /** Injectable for tests; defaults to fs.realpathSync. Throws ENOENT for missing paths. */
  realpath?: (p: string) => string
}

function isInside(rootDir: string, target: string): boolean {
  const rel = path.relative(rootDir, target)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

/** Real path of the nearest existing ancestor of `target` (target itself may not exist yet). */
function realpathOfNearestAncestor(target: string, realpath: (p: string) => string): string | null {
  let current = target
  for (;;) {
    try {
      return realpath(current)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) { return null }
      current = parent
    }
  }
}

/**
 * Resolves `candidate` (workspace-relative, or absolute but already inside the root)
 * to a file path strictly inside `root`. Rejects traversal, drive/UNC escapes, NUL
 * bytes, the root itself, `.git`, and symlinks that point outside the root.
 */
export function resolveWithinRoot(root: string, candidate: string, options: ResolveOptions = {}): PathResolution {
  const realpath = options.realpath ?? ((p: string) => fs.realpathSync(p))
  const raw = candidate?.trim() ?? ''
  if (!raw) { return { ok: false, reason: 'Empty file path.' } }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(raw)) { return { ok: false, reason: 'File path contains control characters.' } }

  const segments = raw.split(/[\\/]+/)
  if (segments.includes('..')) { return { ok: false, reason: 'File path may not contain ".." segments.' } }
  if (/^[A-Za-z]:/.test(raw) && !path.isAbsolute(raw)) {
    return { ok: false, reason: 'Drive-qualified paths are not allowed.' }
  }
  if (segments.some(s => DENIED_SEGMENTS.has(s.toLowerCase()))) {
    return { ok: false, reason: 'Writing inside .git is not allowed.' }
  }

  const rootResolved = path.resolve(root)
  const fullPath = path.resolve(rootResolved, raw)
  if (!isInside(rootResolved, fullPath)) {
    return { ok: false, reason: 'File path resolves outside the workspace.' }
  }

  // Symlink escape: the deepest existing ancestor must really live under the real root.
  const rootReal = realpathOfNearestAncestor(rootResolved, realpath)
  const ancestorReal = realpathOfNearestAncestor(fullPath, realpath)
  if (!rootReal || !ancestorReal || !(ancestorReal === rootReal || isInside(rootReal, ancestorReal))) {
    return { ok: false, reason: 'File path escapes the workspace through a symlink.' }
  }

  return { ok: true, fullPath, relative: path.relative(rootResolved, fullPath).split(path.sep).join('/') }
}
