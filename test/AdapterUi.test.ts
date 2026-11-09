import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adapterById } from '../src/adapters/AdapterCatalog'
import type { AdapterReport } from '../src/adapters/AdapterService'
import type { AdapterState } from '../src/adapters/AdapterStatus'

const ui = vi.hoisted(() => ({
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showQuickPick: vi.fn(),
  writeText: vi.fn(),
  getConfiguration: vi.fn(),
  reportAdapters: vi.fn(),
  createProjectTerminal: vi.fn(),
  sendToTerminal: vi.fn(),
  warn: vi.fn(),
  trusted: { value: true },
  terminal: { sendText: vi.fn(), show: vi.fn() },
}))

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: ui.showInformationMessage,
    showWarningMessage: ui.showWarningMessage,
    showQuickPick: ui.showQuickPick,
  },
  workspace: { getConfiguration: ui.getConfiguration },
  env: { clipboard: { writeText: ui.writeText } },
  commands: { registerCommand: vi.fn() },
}))
vi.mock('../src/adapters/AdapterService', () => ({ reportAdapters: ui.reportAdapters }))
vi.mock('../src/workspace/ProjectTerminal', () => ({
  createProjectTerminal: ui.createProjectTerminal,
  sendToTerminal: ui.sendToTerminal,
}))
vi.mock('../src/workspace/Trust', () => ({ isWorkspaceTrusted: () => ui.trusted.value }))
vi.mock('../src/util/Logger', () => ({ Logger: { warn: ui.warn } }))

type UiModule = typeof import('../src/adapters/AdapterUi')
let mod: UiModule

/** Stands in for the workspace-state Memento. `store` exposes what was written. */
function memento(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial))
  return {
    store,
    get: <T>(key: string, fallback?: T): T => (store.has(key) ? (store.get(key) as T) : (fallback as T)),
    update: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
  }
}

function missing(id: string): AdapterReport {
  return { entry: adapterById(id)!, state: { kind: 'missing' } }
}

const installedGlobally: AdapterState = { kind: 'installed', where: 'global', version: '0.4.0' }

beforeEach(async () => {
  // Each test gets a fresh module, because the once-per-session prompt memory lives in the module.
  vi.resetModules()
  mod = await import('../src/adapters/AdapterUi')
  vi.clearAllMocks()
  ui.trusted.value = true
  ui.sendToTerminal.mockImplementation((term: typeof ui.terminal, text: string, execute?: boolean) => term.sendText(text, execute))
})

describe('isMissing and dismissalKey', () => {
  it('offers install only for a tool the check found absent, never for one it could not check', () => {
    expect(mod.isMissing({ kind: 'missing' })).toBe(true)
    expect(mod.isMissing({ kind: 'toolchain-missing', tool: 'gem' })).toBe(false)
    expect(mod.isMissing({ kind: 'unknown', reason: 'untrusted' })).toBe(false)
    expect(mod.isMissing(installedGlobally)).toBe(false)
  })

  it('keys the "Don\'t ask" choice per tool', () => {
    expect(mod.dismissalKey('debug-mcp')).toBe('railsforge.adapters.dismissed.debug-mcp')
  })
})

describe('promptIfMissing', () => {
  it('asks about an enabled, missing tool, and stores "Don\'t ask" for this workspace', async () => {
    ui.showInformationMessage.mockResolvedValue("Don't ask in this workspace")
    const memory = memento()
    await mod.promptIfMissing({ report: missing('debug-mcp'), root: '/app', memory, enabled: true, promptWhenMissing: true })
    expect(ui.showInformationMessage).toHaveBeenCalledTimes(1)
    expect(memory.update).toHaveBeenCalledWith(mod.dismissalKey('debug-mcp'), true)
  })

  it('stays silent when the tool is not enabled, prompting is off, the tool is installed, or it was dismissed', async () => {
    const memory = memento({ [mod.dismissalKey('gems-mcp')]: true })
    await mod.promptIfMissing({ report: missing('debug-mcp'), root: '/app', memory, enabled: false, promptWhenMissing: true })
    await mod.promptIfMissing({ report: missing('debug-mcp'), root: '/app', memory, enabled: true, promptWhenMissing: false })
    await mod.promptIfMissing({ report: { entry: adapterById('ruby-console-mcp')!, state: installedGlobally }, root: '/app', memory, enabled: true, promptWhenMissing: true })
    await mod.promptIfMissing({ report: missing('gems-mcp'), root: '/app', memory, enabled: true, promptWhenMissing: true })
    expect(ui.showInformationMessage).not.toHaveBeenCalled()
  })

  it('asks at most once per session, even after "Not now"', async () => {
    ui.showInformationMessage.mockResolvedValue('Not now')
    const memory = memento()
    const input = { report: missing('debug-mcp'), root: '/app', memory, enabled: true, promptWhenMissing: true }
    await mod.promptIfMissing(input)
    await mod.promptIfMissing(input)
    expect(ui.showInformationMessage).toHaveBeenCalledTimes(1)
    expect(memory.update).not.toHaveBeenCalled()
  })

  it('starts the install flow when the user chooses "Install…"', async () => {
    ui.showInformationMessage.mockResolvedValue('Install…')
    ui.trusted.value = true
    ui.createProjectTerminal.mockReturnValue(ui.terminal)
    await mod.promptIfMissing({ report: missing('gems-mcp'), root: '/app', memory: memento(), enabled: true, promptWhenMissing: true })
    expect(ui.terminal.sendText).toHaveBeenCalledWith('npm install -g @ruby-mcp/gems-mcp', false)
  })
})

describe('installAdapter', () => {
  it('in an untrusted workspace, opens no terminal and only offers to copy the command', async () => {
    ui.trusted.value = false
    ui.showWarningMessage.mockResolvedValue('Copy command')
    await mod.installAdapter(adapterById('actionmcp')!, '/app')
    expect(ui.createProjectTerminal).not.toHaveBeenCalled()
    expect(ui.sendToTerminal).not.toHaveBeenCalled()
    expect(ui.writeText).toHaveBeenCalledWith(
      'bundle add actionmcp && bin/rails action_mcp:install:migrations && bin/rails generate action_mcp:install && bin/rails db:migrate',
    )
  })

  it('in a trusted workspace, types the command into a RailsForge terminal without pressing Enter', async () => {
    ui.createProjectTerminal.mockReturnValue(ui.terminal)
    await mod.installAdapter(adapterById('rails-mcp-server')!, '/app')
    expect(ui.createProjectTerminal).toHaveBeenCalledWith({ name: 'RailsForge: install rails-mcp-server', cwd: '/app' })
    expect(ui.terminal.sendText).toHaveBeenCalledWith('gem install rails-mcp-server', false)
    expect(ui.terminal.show).toHaveBeenCalled()
  })

  it('asks which plan to use when a tool has more than one, and installs nothing when the choice is dismissed', async () => {
    ui.createProjectTerminal.mockReturnValue(ui.terminal)
    ui.showQuickPick.mockResolvedValueOnce(undefined)
    await mod.installAdapter(adapterById('debug-mcp')!, '/app')
    expect(ui.createProjectTerminal).not.toHaveBeenCalled()

    ui.showQuickPick.mockImplementationOnce(async (items: Array<{ plan: { steps: readonly string[] } }>) => items[1])
    await mod.installAdapter(adapterById('debug-mcp')!, '/app')
    expect(ui.terminal.sendText).toHaveBeenCalledWith('bundle add debug-mcp --group development', false)
  })
})

describe('checkEnabledAdapters', () => {
  it('checks only the enabled tools it recognises', async () => {
    const settings: Record<string, unknown> = { 'adapters.enabled': ['not-a-tool', 'gems-mcp'], 'adapters.promptWhenMissing': false }
    ui.getConfiguration.mockReturnValue({ get: (key: string, fallback: unknown) => (key in settings ? settings[key] : fallback) })
    ui.reportAdapters.mockResolvedValue([])
    await mod.checkEnabledAdapters(memento(), '/app')
    expect(ui.reportAdapters).toHaveBeenCalledWith('/app', ['gems-mcp'])
  })

  it('probes nothing when no tool is enabled', async () => {
    ui.getConfiguration.mockReturnValue({ get: (_key: string, fallback: unknown) => fallback })
    await mod.checkEnabledAdapters(memento(), '/app')
    expect(ui.reportAdapters).not.toHaveBeenCalled()
  })

  it('never rejects: a failure is logged and activation carries on', async () => {
    ui.getConfiguration.mockImplementation(() => {
      throw new Error('configuration unavailable')
    })
    await expect(mod.checkEnabledAdapters(memento(), '/app')).resolves.toBeUndefined()
    expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining('configuration unavailable'))
  })
})
