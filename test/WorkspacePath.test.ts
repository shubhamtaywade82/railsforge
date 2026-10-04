import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { resolveWithinRoot } from '../src/util/WorkspacePath'

describe('resolveWithinRoot', () => {
  let tmp: string
  let root: string
  let outside: string

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-wp-')))
    root = path.join(tmp, 'app_root')
    outside = path.join(tmp, 'outside')
    fs.mkdirSync(path.join(root, 'app', 'models'), { recursive: true })
    fs.mkdirSync(outside)
  })
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('resolves a relative path, including not-yet-existing directories', () => {
    const r = resolveWithinRoot(root, 'app/services/new_service.rb')
    expect(r).toEqual({ ok: true, fullPath: path.join(root, 'app', 'services', 'new_service.rb'), relative: 'app/services/new_service.rb' })
  })

  it('accepts an absolute path that is already inside the root (no double-join)', () => {
    const abs = path.join(root, 'app', 'models', 'user.rb')
    const r = resolveWithinRoot(root, abs)
    expect(r).toMatchObject({ ok: true, fullPath: abs, relative: 'app/models/user.rb' })
  })

  it.each([
    ['../escape.rb'],
    ['app/../../escape.rb'],
    ['app\\..\\..\\escape.rb'],
    ['..'],
    ['./../x'],
  ])('rejects traversal: %s', candidate => {
    const r = resolveWithinRoot(root, candidate)
    expect(r.ok).toBe(false)
  })

  it('rejects absolute paths outside the root', () => {
    expect(resolveWithinRoot(root, path.join(outside, 'x.rb')).ok).toBe(false)
    expect(resolveWithinRoot(root, process.platform === 'win32' ? 'C:\\Windows\\x.rb' : '/etc/passwd').ok).toBe(false)
  })

  it('rejects sibling directories that merely share the root prefix', () => {
    const sibling = `${root}_evil`
    expect(resolveWithinRoot(root, path.join(sibling, 'x.rb')).ok).toBe(false)
  })

  it('rejects empty input, NUL and control characters, and the root itself', () => {
    expect(resolveWithinRoot(root, '').ok).toBe(false)
    expect(resolveWithinRoot(root, '   ').ok).toBe(false)
    expect(resolveWithinRoot(root, 'app/a\u0000.rb').ok).toBe(false)
    expect(resolveWithinRoot(root, 'app/a\n.rb').ok).toBe(false)
    expect(resolveWithinRoot(root, '.').ok).toBe(false)
  })

  it('rejects drive-qualified relative paths on non-Windows hosts', () => {
    if (process.platform === 'win32') { return }
    expect(resolveWithinRoot(root, 'C:evil.rb').ok).toBe(false)
  })

  it('rejects writes inside .git in any case', () => {
    expect(resolveWithinRoot(root, '.git/hooks/pre-commit').ok).toBe(false)
    expect(resolveWithinRoot(root, 'sub/.GIT/config').ok).toBe(false)
    expect(resolveWithinRoot(root, '.gitignore').ok).toBe(true)
  })

  it('rejects a symlinked directory that points outside the root', () => {
    const link = path.join(root, 'linked')
    try {
      fs.symlinkSync(outside, link, 'junction')
    } catch {
      return // symlink creation not permitted on this host
    }
    expect(resolveWithinRoot(root, 'linked/new.rb').ok).toBe(false)
    // A symlink that stays inside the root is fine.
    const inner = path.join(root, 'inner_link')
    fs.symlinkSync(path.join(root, 'app'), inner, 'junction')
    expect(resolveWithinRoot(root, 'inner_link/new.rb').ok).toBe(true)
  })

  it('fails closed when realpath cannot resolve anything', () => {
    const r = resolveWithinRoot(root, 'app/x.rb', { realpath: () => { throw new Error('EIO') } })
    expect(r.ok).toBe(false)
  })
})
