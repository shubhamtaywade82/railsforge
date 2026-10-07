/**
 * ConventionalCommitGenerator - generates a Conventional Commit message from a staged
 * `git diff --cached` output, using the SemanticIndex and PatternCatalogAccess to
 * classify files by their Rails pattern type.
 *
 * Pure function (no vscode import) so it is unit-testable without VS Code. The
 * SourceControlProvider wraps this function and feeds it the staged diff.
 *
 * Conventional Commit format: `<type>[optional scope]: <description>`
 *
 * Type inference rules (first match wins):
 *   - Files under db/migrate/               -> `feat` (schema change) or `fix` (migration fix)
 *   - Files under spec/ or test/            -> `test`
 *   - Files under config/routes.rb          -> `feat` (route added) or `refactor`
 *   - Files under app/services/ (new file)  -> `feat` (new service)
 *   - Files under app/services/ (modified)  -> `refactor`
 *   - Files under app/models/ (new file)    -> `feat` (new model)
 *   - Files under app/controllers/          -> `refactor` (controller change)
 *   - Files under app/views/ or app/components/ -> `feat` (UI change)
 *   - Files under lib/ or config/ initializers -> `chore`
 *   - Default                               -> `chore`
 *
 * Scope inference: the Rails pattern type of the primary changed file
 * (e.g. `service`, `model`, `controller`), or the top-level directory name.
 */

import { SemanticIndex } from './SemanticIndex'
import { PatternCatalogAccess } from './PatternCatalogAccess'

/** A parsed diff entry for a single file. */
export interface DiffFileEntry {
  /** Path as it appears in the diff (e.g. `app/services/checkout.rb`). */
  path: string
  /** 'added' | 'deleted' | 'modified' | 'renamed' — inferred from the diff header. */
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  /** Number of added lines (excluding context). */
  additions: number
  /** Number of deleted lines (excluding context). */
  deletions: number
}

/** The generated commit message parts. */
export interface ConventionalCommit {
  type: string
  scope?: string
  description: string
  /** Full message string, e.g. `feat(orders): extract CheckoutService from controller`. */
  toString(): string
}

/** Parse a unified diff into per-file entries. Pure function, no side effects. */
export function parseDiffFiles(diff: string): DiffFileEntry[] {
  const entries: DiffFileEntry[] = []
  const lines = diff.split('\n')
  let current: DiffFileEntry | null = null
  let inHunk = false

  for (const line of lines) {
    // Diff header lines: `diff --git a/path b/path` or `--- a/path` / `+++ b/path`
    const diffMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
    if (diffMatch) {
      if (current) {entries.push(current)}
      current = {
        path: diffMatch[2],
        status: 'modified',
        additions: 0,
        deletions: 0,
      }
      inHunk = false
      continue
    }

    // Rename detection: `rename from old` / `rename to new`
    if (current && line.startsWith('rename from ')) {
      current.status = 'renamed'
      continue
    }

    // New file: `new file mode 100644`
    if (current && line.startsWith('new file mode ')) {
      current.status = 'added'
      continue
    }

    // Deleted file: `deleted file mode 100644`
    if (current && line.startsWith('deleted file mode ')) {
      current.status = 'deleted'
      continue
    }

    // Hunk start: `@@ -a,b +c,d @@`
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }

    // Count additions/deletions inside hunks
    if (inHunk && current) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        current.additions++
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        current.deletions++
      }
    }
  }
  if (current) {entries.push(current)}
  return entries
}

/** Infer the Conventional Commit type from the changed files. */
function inferType(files: DiffFileEntry[]): string {
  // No files -> empty commit
  if (files.length === 0) {return 'chore'}

  // Any migration -> schema change
  if (files.some(f => f.path.includes('db/migrate/'))) {
    return files.some(f => f.status === 'added') ? 'feat' : 'fix'
  }

  // Only test files -> test
  if (files.every(f => f.path.startsWith('spec/') || f.path.startsWith('test/'))) {
    return 'test'
  }

  // New service/model/controller -> feat
  if (files.some(f => f.status === 'added' && (f.path.includes('/services/') || f.path.includes('/models/') || f.path.includes('/controllers/')))) {
    return 'feat'
  }

  // Only view/component changes -> feat (UI)
  if (files.every(f => f.path.includes('/views/') || f.path.includes('/components/'))) {
    return 'feat'
  }

  // Routes change -> feat (new route) or refactor
  if (files.some(f => f.path.endsWith('config/routes.rb'))) {
    return 'feat'
  }

  // Lib/config/initializer -> chore
  if (files.every(f => f.path.startsWith('lib/') || f.path.startsWith('config/initializers/') || f.path.startsWith('config/'))) {
    return 'chore'
  }

  // Default: refactor (most Rails source changes are refactoring)
  return 'refactor'
}

/** Infer the scope from the changed files. Prefers newly-added pattern instances
 * (a new Service Object is more significant than a 12-line controller modification),
 * then falls back to the primary file (most diff lines), then to the directory. */
function inferScope(files: DiffFileEntry[], catalog: PatternCatalogAccess): string | undefined {
  if (files.length === 0) {return undefined}

  const instances = catalog.listProjectInstances()

  // 1. Check if any ADDED file matches a project pattern instance — newly-added
  //    patterns (services, queries, forms) take scope priority.
  const addedFiles = files.filter(f => f.status === 'added')
  for (const file of addedFiles) {
    for (const instance of instances) {
      if (file.path === instance.filePath || file.path.endsWith(instance.filePath) || instance.filePath.endsWith(file.path)) {
        return instance.type
      }
    }
  }

  // 2. Sort by impact (additions + deletions) descending — the "primary" file
  const sorted = [...files].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
  const primary = sorted[0]

  // 3. Try to match the primary file against project pattern instances
  for (const instance of instances) {
    if (primary.path === instance.filePath || primary.path.endsWith(instance.filePath) || instance.filePath.endsWith(primary.path)) {
      return instance.type
    }
  }

  // 4. Fall back to the Rails directory segment
  const parts = primary.path.split('/')
  const appIdx = parts.indexOf('app')
  if (appIdx >= 0 && appIdx + 1 < parts.length) {
    return parts[appIdx + 1].replace(/s$/, '') // "services" -> "service", "controllers" -> "controller"
  }

  // db/migrate -> "migration"
  if (primary.path.includes('db/migrate/')) {return 'migration'}
  // config/routes.rb -> "routes"
  if (primary.path.endsWith('config/routes.rb')) {return 'routes'}
  // spec/ or test/ -> "test"
  if (primary.path.startsWith('spec/') || primary.path.startsWith('test/')) {return 'test'}

  // Top-level directory
  return parts[0]
}

/** Generate a short description from the primary file name and change type. */
function inferDescription(files: DiffFileEntry[]): string {
  if (files.length === 0) {return 'empty commit'}
  if (files.length === 1) {
    const f = files[0]
    const basename = f.path.split('/').pop()!.replace(/\.\w+$/, '')
    switch (f.status) {
      case 'added': return `add ${basename}`
      case 'deleted': return `remove ${basename}`
      case 'renamed': return `rename ${basename}`
      default: return `update ${basename}`
    }
  }
  // Multiple files: summarize
  const added = files.filter(f => f.status === 'added').length
  const modified = files.filter(f => f.status === 'modified').length
  const deleted = files.filter(f => f.status === 'deleted').length
  const parts: string[] = []
  if (added) {parts.push(`add ${added} file${added > 1 ? 's' : ''}`)}
  if (modified) {parts.push(`update ${modified} file${modified > 1 ? 's' : ''}`)}
  if (deleted) {parts.push(`remove ${deleted} file${deleted > 1 ? 's' : ''}`)}
  return parts.join(', ')
}

/**
 * Generate a Conventional Commit message from a staged diff. Returns undefined if
 * the diff is empty or no message could be confidently generated.
 */
export function generateConventionalCommit(
  diff: string,
  _index: SemanticIndex,
  catalog: PatternCatalogAccess,
): ConventionalCommit | undefined {
  const files = parseDiffFiles(diff)
  if (files.length === 0) {return undefined}

  const type = inferType(files)
  const scope = inferScope(files, catalog)
  const description = inferDescription(files)

  return {
    type,
    scope,
    description,
    toString(): string {
      return scope ? `${type}(${scope}): ${description}` : `${type}: ${description}`
    },
  }
}
