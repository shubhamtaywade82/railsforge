import { describe, expect, it } from 'vitest'
import { adapterById } from '../src/adapters/AdapterCatalog'
import { compareVersions, describeState, launchSpecFor, resolveAdapterState, shouldPromptForMissing } from '../src/adapters/AdapterStatus'

const debug = adapterById('debug-mcp')!
const noGems = new Map<string, string>()

describe('compareVersions', () => {
  it('orders dotted versions numerically', () => {
    expect(compareVersions('3.10.0', '3.9.9')).toBeGreaterThan(0)
    expect(compareVersions('3.2', '3.2.0')).toBe(0)
    expect(compareVersions('3.1.2', '3.2.0')).toBeLessThan(0)
  })
})

describe('resolveAdapterState', () => {
  it('recognises a project gem from the lockfile, without asking the machine', () => {
    const state = resolveAdapterState({
      entry: debug,
      projectGems: new Map([['debug-mcp', '0.4.0']]),
      globalProbe: { found: null, reason: 'untrusted' },
    })
    expect(state).toEqual({ kind: 'installed', where: 'project', version: '0.4.0' })
  })

  it('reports a global install, and flags a Ruby older than the tool requires', () => {
    expect(resolveAdapterState({ entry: debug, projectGems: noGems, globalProbe: { found: true, version: '0.4.0' }, detectedRuby: '3.3.1' }))
      .toEqual({ kind: 'installed', where: 'global', version: '0.4.0' })
    expect(resolveAdapterState({ entry: debug, projectGems: noGems, globalProbe: { found: true }, detectedRuby: '3.1.4' }))
      .toEqual({ kind: 'ruby-too-old', detected: '3.1.4', required: '3.2.0' })
  })

  it('reports missing only when the probe actually answered no', () => {
    expect(resolveAdapterState({ entry: debug, projectGems: noGems, globalProbe: { found: false } })).toEqual({ kind: 'missing' })
  })

  it('never reports missing for a tool whose global probe was not run', () => {
    expect(resolveAdapterState({ entry: debug, projectGems: noGems })).toEqual({ kind: 'unknown', reason: 'probe-failed' })
  })

  it('never reports missing when the check could not run', () => {
    expect(resolveAdapterState({ entry: debug, projectGems: noGems, globalProbe: { found: null, reason: 'untrusted' } }))
      .toEqual({ kind: 'unknown', reason: 'untrusted' })
    expect(resolveAdapterState({ entry: debug, projectGems: noGems, globalProbe: { found: null, reason: 'probe-failed' } }))
      .toEqual({ kind: 'unknown', reason: 'probe-failed' })
  })

  it('names the command that is absent when the toolchain is missing', () => {
    expect(resolveAdapterState({ entry: debug, projectGems: noGems, globalProbe: { found: null, reason: 'toolchain-missing' } }))
      .toEqual({ kind: 'toolchain-missing', tool: 'gem' })
    expect(resolveAdapterState({ entry: adapterById('gems-mcp')!, projectGems: noGems, globalProbe: { found: null, reason: 'toolchain-missing' } }))
      .toEqual({ kind: 'toolchain-missing', tool: 'npm' })
  })
})

describe('shouldPromptForMissing', () => {
  const missing = { kind: 'missing' as const }

  it('prompts only for an enabled, missing tool that was not dismissed', () => {
    expect(shouldPromptForMissing({ enabled: true, promptWhenMissing: true, dismissed: false, state: missing })).toBe(true)
    expect(shouldPromptForMissing({ enabled: false, promptWhenMissing: true, dismissed: false, state: missing })).toBe(false)
    expect(shouldPromptForMissing({ enabled: true, promptWhenMissing: false, dismissed: false, state: missing })).toBe(false)
    expect(shouldPromptForMissing({ enabled: true, promptWhenMissing: true, dismissed: true, state: missing })).toBe(false)
    expect(shouldPromptForMissing({ enabled: true, promptWhenMissing: true, dismissed: false, state: { kind: 'unknown', reason: 'untrusted' } }))
      .toBe(false)
  })
})

describe('launchSpecFor', () => {
  const root = '/app'

  it('runs a project gem through bundler, so it uses the application lockfile version', () => {
    expect(launchSpecFor(debug, { kind: 'installed', where: 'project' }, root)).toEqual({ command: 'bundle', args: ['exec', 'debug-mcp'], cwd: root })
  })

  it('runs a global tool from its executable', () => {
    expect(launchSpecFor(debug, { kind: 'installed', where: 'global' }, root)).toEqual({ command: 'debug-mcp', args: [], cwd: root })
  })

  it('returns nothing for a tool that is not installed, or whose executable is not known', () => {
    expect(launchSpecFor(debug, { kind: 'missing' }, root)).toBeUndefined()
    expect(launchSpecFor(adapterById('ask-ruby-harness-mcp')!, { kind: 'installed', where: 'global' }, root)).toBeUndefined()
  })
})

describe('describeState', () => {
  it('says plainly what each state means', () => {
    expect(describeState({ kind: 'missing' })).toBe('Not installed.')
    expect(describeState({ kind: 'unknown', reason: 'untrusted' })).toContain('Trust this workspace')
    expect(describeState({ kind: 'ruby-too-old', detected: '3.1.4', required: '3.2.0' })).toContain('3.2.0')
  })
})
