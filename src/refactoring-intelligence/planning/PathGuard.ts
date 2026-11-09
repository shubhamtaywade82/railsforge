/**
 * PathGuard - the only gate between a model-supplied path and the filesystem.
 *
 * Paths the advisor may touch are workspace-relative Ruby files under the four Rails source roots.
 * Anything else is rejected, including config/, db/, Gemfile, vendor/ and dotfiles. The model is
 * never trusted to name a location outside that set.
 */

export const ADVISOR_ALLOWED_ROOTS = ['app/', 'lib/', 'spec/', 'test/'] as const

const MAX_PATH_CHARS = 200

export type PathCheck = { ok: true; path: string } | { ok: false; message: string }

export function checkAdvisorPath(raw: string): PathCheck {
  const path = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '')

  if (path === '') {return fail('an empty path')}
  if (path.length > MAX_PATH_CHARS) {return fail(`a path longer than ${MAX_PATH_CHARS} characters`)}
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the purpose of this check
  if (/[\u0000-\u001f\u007f]/.test(path)) {return fail('a path with control characters')}
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {return fail(`an absolute path (${path})`)}
  if (path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    return fail(`a path with empty or relative segments (${path})`)
  }
  if (!ADVISOR_ALLOWED_ROOTS.some(root => path.startsWith(root))) {
    return fail(`${path}: only app/, lib/, spec/ and test/ may be changed`)
  }
  if (!path.endsWith('.rb')) {return fail(`${path}: only Ruby (.rb) files may be changed`)}
  return { ok: true, path }
}

/**
 * Conventional spec/test locations for a source file, checked by the context builder so the model
 * can see how the code is exercised. `app/models/order.rb` -> `spec/models/order_spec.rb`, ...
 */
export function specCandidates(relativePath: string): string[] {
  const match = /^(app|lib)\/(.+)\.rb$/.exec(relativePath)
  if (!match) {return []}
  const rest = match[2]
  return [`spec/${rest}_spec.rb`, `test/${rest}_test.rb`]
}

function fail(what: string): PathCheck {
  return { ok: false, message: `Rejected ${what}.` }
}
