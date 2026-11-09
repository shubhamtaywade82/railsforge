import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileAsync } = vi.hoisted(() => ({ execFileAsync: vi.fn() }))
vi.mock('../src/util/ProjectProcess', () => ({ execFileAsync }))

import { fromNpmListing, probeGlobalGem, probeGlobalNpm, probeRubyVersion } from '../src/adapters/AdapterProbe'
import { UntrustedWorkspaceError } from '../src/workspace/Trust'

beforeEach(() => {
  execFileAsync.mockReset()
})

describe('probeGlobalGem', () => {
  it('reads true from gem list -i', async () => {
    execFileAsync.mockResolvedValue({ stdout: 'true\n', stderr: '' })
    expect(await probeGlobalGem('debug-mcp', '/app')).toEqual({ found: true })
    expect(execFileAsync).toHaveBeenCalledWith('gem', ['list', '-i', 'debug-mcp'], expect.objectContaining({ cwd: '/app' }))
  })

  it('reads false when gem list exits non-zero while printing false', async () => {
    execFileAsync.mockRejectedValue(Object.assign(new Error('exit 1'), { stdout: 'false\n' }))
    expect(await probeGlobalGem('debug-mcp', '/app')).toEqual({ found: false })
  })

  it('reports untrusted when trust refuses the launch', async () => {
    execFileAsync.mockRejectedValue(new UntrustedWorkspaceError('gem'))
    expect(await probeGlobalGem('debug-mcp', '/app')).toEqual({ found: null, reason: 'untrusted' })
  })

  it('reports a missing toolchain when gem cannot be started', async () => {
    execFileAsync.mockRejectedValue(Object.assign(new Error('spawn gem ENOENT'), { code: 'ENOENT' }))
    expect(await probeGlobalGem('debug-mcp', '/app')).toEqual({ found: null, reason: 'toolchain-missing' })
  })

  it('does not call an unexplained failure "missing"', async () => {
    execFileAsync.mockRejectedValue(new Error('boom'))
    expect(await probeGlobalGem('debug-mcp', '/app')).toEqual({ found: null, reason: 'probe-failed' })
  })
})

describe('probeGlobalNpm', () => {
  it('reads an installed package from the npm listing', async () => {
    execFileAsync.mockResolvedValue({ stdout: JSON.stringify({ dependencies: { 'ruby-console-mcp': { version: '1.0.1' } } }), stderr: '' })
    expect(await probeGlobalNpm('ruby-console-mcp', '/app')).toEqual({ found: true, version: '1.0.1' })
  })

  it('reads a missing package from the JSON that npm prints when it exits non-zero', async () => {
    execFileAsync.mockRejectedValue(Object.assign(new Error('exit 1'), { stdout: '{}' }))
    expect(await probeGlobalNpm('ruby-console-mcp', '/app')).toEqual({ found: false })
  })

  it('treats a listing it cannot read as a failed probe', () => {
    expect(fromNpmListing('not json', 'ruby-console-mcp')).toEqual({ found: null, reason: 'probe-failed' })
  })
})

describe('probeRubyVersion', () => {
  it('returns the version the Ruby on the PATH reports', async () => {
    execFileAsync.mockResolvedValue({ stdout: '3.3.1', stderr: '' })
    expect(await probeRubyVersion('/app')).toBe('3.3.1')
  })

  it('returns undefined when Ruby cannot be run', async () => {
    execFileAsync.mockRejectedValue(new Error('no ruby'))
    expect(await probeRubyVersion('/app')).toBeUndefined()
  })
})
