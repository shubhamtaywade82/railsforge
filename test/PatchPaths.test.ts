import { describe, it, expect } from 'vitest'
import { normalizePatchPath, patchFileMatches } from '../src/patch/PatchPaths'

const root = '/ws/app'

describe('patchFileMatches', () => {
  it('matches exact workspace-relative paths including git prefixes', () => {
    const doc = '/ws/app/app/models/user.rb'
    expect(patchFileMatches('app/models/user.rb', doc, root)).toBe(true)
    expect(patchFileMatches('./app/models/user.rb', doc, root)).toBe(true)
    expect(patchFileMatches('a/app/models/user.rb', doc, root)).toBe(true)
    expect(patchFileMatches('b/app/models/user.rb', doc, root)).toBe(true)
    expect(patchFileMatches('/ws/app/app/models/user.rb', doc, root)).toBe(true)
  })

  it('does not confuse same-basename files in different directories', () => {
    expect(patchFileMatches('app/models/user.rb', '/ws/app/lib/user.rb', root)).toBe(false)
    expect(patchFileMatches('user.rb', '/ws/app/app/models/user.rb', root)).toBe(false)
  })

  it('rejects documents outside the workspace root', () => {
    expect(patchFileMatches('user.rb', '/other/user.rb', root)).toBe(false)
  })

  it('normalizes backslashes', () => {
    expect(normalizePatchPath('app\\models\\user.rb')).toBe('app/models/user.rb')
  })
})
