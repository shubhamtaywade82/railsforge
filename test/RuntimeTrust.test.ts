import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const state = vi.hoisted(() => ({
  isTrusted: true,
  introspectionEnabled: false,
  choice: undefined as string | undefined,
  warnings: [] as string[],
}))

vi.mock('vscode', () => ({
  workspace: {
    get isTrusted() { return state.isTrusted },
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => (key === 'runtime.introspection.enabled' ? state.introspectionEnabled : fallback),
      update: vi.fn(),
    }),
  },
  window: {
    showWarningMessage: vi.fn(async (message: string) => { state.warnings.push(message); return state.choice }),
    showErrorMessage: vi.fn(),
    withProgress: vi.fn(async (_opts: unknown, task: () => unknown) => task()),
  },
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Workspace: 2 },
}))

import { refreshRuntimeSnapshot } from '../src/rails/RuntimeIntrospectionService'

function railsRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-trust-'))
  fs.mkdirSync(path.join(root, 'config'), { recursive: true })
  fs.writeFileSync(path.join(root, 'config', 'application.rb'), 'module App; end\n')
  return root
}

const scriptPath = (root: string): string => path.join(root, '.railsforge', 'introspect.rb')

describe('runtime introspection trust and consent gate', () => {
  beforeEach(() => {
    state.isTrusted = true
    state.introspectionEnabled = false
    state.choice = undefined
    state.warnings = []
  })

  it('refuses in an untrusted workspace and writes nothing', async () => {
    state.isTrusted = false
    state.introspectionEnabled = true // even a pre-granted setting must not bypass workspace trust
    const root = railsRoot()
    expect(await refreshRuntimeSnapshot(root)).toBeUndefined()
    expect(state.warnings.join(' ')).toContain('untrusted')
    expect(fs.existsSync(scriptPath(root))).toBe(false)
  })

  it('asks for consent first and writes nothing when the user declines', async () => {
    const root = railsRoot()
    state.choice = undefined // dialog dismissed
    expect(await refreshRuntimeSnapshot(root)).toBeUndefined()
    expect(state.warnings.join(' ')).toContain('boot your Rails application')
    expect(fs.existsSync(scriptPath(root))).toBe(false)
  })

  it('does nothing outside a Rails app', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-nonrails-'))
    state.introspectionEnabled = true
    expect(await refreshRuntimeSnapshot(root)).toBeUndefined()
    expect(fs.existsSync(scriptPath(root))).toBe(false)
  })
})
