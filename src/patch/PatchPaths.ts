/**
 * Exact file identity for AI-produced diffs. Hunks are matched to a document by
 * workspace-relative path, never by basename (app/models/user.rb !== lib/user.rb).
 */

import * as path from 'path'

/** Canonical POSIX workspace-relative form: strips ./, a/ b/ prefixes, and normalizes separators. */
export function normalizePatchPath(file: string): string {
  let p = file.trim().replace(/\\/g, '/')
  p = p.replace(/^(?:\.\/)+/, '')
  p = path.posix.normalize(p)
  return p
}

function stripDiffPrefix(p: string): string {
  return p.replace(/^[ab]\//, '')
}

/**
 * True when `hunkFile` identifies `documentFsPath` inside `workspaceRoot`.
 * Accepts `a/` / `b/` git prefixes, `./`, and absolute paths. A `a/`-prefixed
 * candidate is only stripped when the raw form doesn't already match, so a real
 * top-level `a/` directory still resolves.
 */
export function patchFileMatches(hunkFile: string, documentFsPath: string, workspaceRoot: string): boolean {
  const rel = normalizePatchPath(path.relative(workspaceRoot, documentFsPath))
  if (rel.startsWith('..') || path.isAbsolute(rel)) {return false}

  const raw = normalizePatchPath(hunkFile)
  const candidates = new Set<string>([raw, stripDiffPrefix(raw)])
  if (path.isAbsolute(hunkFile) || /^[A-Za-z]:[\\/]/.test(hunkFile)) {
    candidates.add(normalizePatchPath(path.relative(workspaceRoot, hunkFile)))
  }
  return candidates.has(rel)
}
