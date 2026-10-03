import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { ToolchainEnv, detectVersionManager, rubyCommandCandidates } from '../src/environment/RubyToolchain'

function fakeEnv(files: Record<string, string>, binaries: string[], platform: NodeJS.Platform = 'linux'): ToolchainEnv {
  const abs = (p: string): string => path.join('/p', p)
  const map = new Map(Object.entries(files).map(([k, v]) => [abs(k), v]))
  return {
    exists: p => map.has(p),
    readFile: p => map.get(p),
    onPath: c => binaries.includes(c),
    platform,
  }
}

describe('detectVersionManager', () => {
  it('prefers mise for mise.toml / .tool-versions, falling back to asdf', () => {
    expect(detectVersionManager('/p', fakeEnv({ '.tool-versions': 'ruby 3.3.0\n' }, ['mise', 'asdf']))).toBe('mise')
    expect(detectVersionManager('/p', fakeEnv({ '.tool-versions': 'ruby 3.3.0\n' }, ['asdf']))).toBe('asdf')
    expect(detectVersionManager('/p', fakeEnv({ 'mise.toml': '[tools]\nruby = "3.3"\n' }, ['mise']))).toBe('mise')
  })

  it('uses rbenv for a bare .ruby-version, and none when no manager is installed', () => {
    expect(detectVersionManager('/p', fakeEnv({ '.ruby-version': '3.3.0' }, ['rbenv']))).toBe('rbenv')
    expect(detectVersionManager('/p', fakeEnv({ '.ruby-version': '3.3.0' }, []))).toBe('none')
  })

  it('ignores a .tool-versions without ruby', () => {
    expect(detectVersionManager('/p', fakeEnv({ '.tool-versions': 'nodejs 22\n' }, ['mise', 'asdf']))).toBe('none')
  })

  it('honours explicit settings and never wraps on Windows in auto', () => {
    expect(detectVersionManager('/p', fakeEnv({}, ['rvm']), 'rvm')).toBe('rvm')
    expect(detectVersionManager('/p', fakeEnv({}, []), 'rvm')).toBe('none')
    expect(detectVersionManager('/p', fakeEnv({}, ['mise']), 'none')).toBe('none')
    expect(detectVersionManager('/p', fakeEnv({ '.ruby-version': '3.3' }, ['rbenv'], 'win32'))).toBe('none')
  })
})

describe('rubyCommandCandidates', () => {
  const stub = path.join('/p', 'bin', 'rubocop')

  it('prefers the binstub, then bundle exec, then the bare tool', () => {
    const env = fakeEnv({ 'bin/rubocop': '', Gemfile: '' }, [])
    expect(rubyCommandCandidates('/p', 'rubocop', ['-a'], env, { manager: 'none' })).toEqual([
      { command: stub, args: ['-a'] },
      { command: 'bundle', args: ['exec', 'rubocop', '-a'] },
      { command: 'rubocop', args: ['-a'] },
    ])
  })

  it('skips bundle exec without a Gemfile and binstubs for non-stub tools', () => {
    const env = fakeEnv({ 'bin/bundle-audit': '' }, [])
    expect(rubyCommandCandidates('/p', 'bundle-audit', ['check'], env, { manager: 'none' })).toEqual([
      { command: 'bundle-audit', args: ['check'] },
    ])
  })

  it('wraps every candidate in the version manager', () => {
    const env = fakeEnv({ Gemfile: '' }, [])
    expect(rubyCommandCandidates('/p', 'rake', ['-T'], env, { manager: 'mise' })[0]).toEqual({
      command: 'mise', args: ['exec', '--', 'bundle', 'exec', 'rake', '-T'],
    })
    expect(rubyCommandCandidates('/p', 'rake', [], env, { manager: 'rbenv' })[1]).toEqual({
      command: 'rbenv', args: ['exec', 'rake'],
    })
    expect(rubyCommandCandidates('/p', 'rake', [], env, { manager: 'asdf' })[0].command).toBe('asdf')
    expect(rubyCommandCandidates('/p', 'rake', [], env, { manager: 'rvm' })[0]).toEqual({
      command: 'rvm', args: ['in', '/p', 'do', 'bundle', 'exec', 'rake'],
    })
  })

  it('chruby needs the version from .ruby-version, otherwise runs unwrapped', () => {
    const withVersion = fakeEnv({ Gemfile: '', '.ruby-version': 'ruby-3.2.2\n' }, [])
    expect(rubyCommandCandidates('/p', 'rake', [], withVersion, { manager: 'chruby' })[0]).toEqual({
      command: 'chruby-exec', args: ['3.2.2', '--', 'bundle', 'exec', 'rake'],
    })
    const without = fakeEnv({ Gemfile: '' }, [])
    expect(rubyCommandCandidates('/p', 'rake', [], without, { manager: 'chruby' })[0].command).toBe('bundle')
  })

  it('runs binstubs through ruby on Windows', () => {
    const env = fakeEnv({ 'bin/rails': '' }, [], 'win32')
    expect(rubyCommandCandidates('/p', 'rails', ['c'], env, { manager: 'none' })[0]).toEqual({
      command: 'ruby', args: [path.join('/p', 'bin', 'rails'), 'c'],
    })
  })
})
