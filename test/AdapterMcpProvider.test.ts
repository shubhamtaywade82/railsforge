import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adapterById } from '../src/adapters/AdapterCatalog'

const host = vi.hoisted(() => {
  const emitters: Array<{ fire: ReturnType<typeof vi.fn> }> = []
  class FakeEmitter {
    readonly event = vi.fn()
    readonly fire = vi.fn()
    constructor() {
      emitters.push(this)
    }
    dispose(): void {}
  }
  class FakeStdio {
    constructor(
      readonly label: string,
      readonly command: string,
      readonly args: string[] = [],
      readonly env?: unknown,
      readonly version?: string,
    ) {}
  }
  return {
    emitters,
    FakeEmitter,
    FakeStdio,
    lmAvailable: { value: true },
    registered: [] as Array<{ id: string; provider: { provideMcpServerDefinitions: () => Promise<unknown[]> } }>,
    config: {} as Record<string, unknown>,
    configListeners: [] as Array<(event: { affectsConfiguration: (section: string) => boolean }) => void>,
    trusted: { value: true },
    reportAdapters: vi.fn(),
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  }
})

vi.mock('vscode', () => ({
  EventEmitter: host.FakeEmitter,
  McpStdioServerDefinition: host.FakeStdio,
  get lm() {
    return host.lmAvailable.value
      ? {
          registerMcpServerDefinitionProvider: (id: string, provider: unknown) => {
            host.registered.push({ id, provider: provider as never })
            return { dispose(): void {} }
          },
        }
      : undefined
  },
  workspace: {
    getConfiguration: () => ({ get: (key: string, fallback: unknown) => (key in host.config ? host.config[key] : fallback) }),
    onDidChangeConfiguration: (listener: never) => {
      host.configListeners.push(listener)
      return { dispose(): void {} }
    },
  },
}))
vi.mock('../src/adapters/AdapterService', () => ({ reportAdapters: (...args: unknown[]) => host.reportAdapters(...args) }))
vi.mock('../src/workspace/Trust', () => ({ isWorkspaceTrusted: () => host.trusted.value }))
vi.mock('../src/util/Logger', () => ({ Logger: host.logger }))

type ProviderModule = typeof import('../src/adapters/AdapterMcpProvider')
let mod: ProviderModule

function fakeContext(): never {
  return { subscriptions: [] } as never
}

const globalDebug = { entry: adapterById('debug-mcp')!, state: { kind: 'installed' as const, where: 'global' as const, version: '0.4.0' } }

beforeEach(async () => {
  // Each test gets a fresh module and fresh host state.
  vi.resetModules()
  host.registered.length = 0
  host.configListeners.length = 0
  host.emitters.length = 0
  host.config = { 'adapters.enabled': ['debug-mcp'], 'adapters.agentExecution': ['debug-mcp'] }
  host.trusted.value = true
  host.lmAvailable.value = true
  host.reportAdapters.mockReset()
  host.logger.warn.mockReset()
  host.logger.info.mockReset()
  host.logger.debug.mockReset()
  mod = await import('../src/adapters/AdapterMcpProvider')
})

describe('registerAdapterMcpProvider', () => {
  it('registers one provider under railsforge.adapters', () => {
    mod.registerAdapterMcpProvider(fakeContext(), () => '/app')
    expect(host.registered.map(r => r.id)).toEqual(['railsforge.adapters'])
  })

  it('offers an enabled, allowed, globally installed debug-mcp as a stdio server', async () => {
    host.reportAdapters.mockResolvedValue([globalDebug])
    mod.registerAdapterMcpProvider(fakeContext(), () => '/app')
    const servers = await host.registered[0].provider.provideMcpServerDefinitions()
    expect(host.reportAdapters).toHaveBeenCalledWith('/app', ['debug-mcp'])
    expect(servers).toHaveLength(1)
    expect(servers[0]).toBeInstanceOf(host.FakeStdio)
    expect(servers[0]).toMatchObject({ label: 'debug-mcp (RailsForge)', command: 'debug-mcp', args: [], version: '0.4.0' })
  })

  it('offers nothing and probes nothing in an untrusted workspace', async () => {
    host.trusted.value = false
    mod.registerAdapterMcpProvider(fakeContext(), () => '/app')
    expect(await host.registered[0].provider.provideMcpServerDefinitions()).toEqual([])
    expect(host.reportAdapters).not.toHaveBeenCalled()
  })

  it('probes nothing when no tool is allowed to run code for the agent', async () => {
    host.config['adapters.agentExecution'] = []
    mod.registerAdapterMcpProvider(fakeContext(), () => '/app')
    expect(await host.registered[0].provider.provideMcpServerDefinitions()).toEqual([])
    expect(host.reportAdapters).not.toHaveBeenCalled()
  })

  it('offers nothing, and logs, when the check fails', async () => {
    host.reportAdapters.mockRejectedValue(new Error('boom'))
    mod.registerAdapterMcpProvider(fakeContext(), () => '/app')
    expect(await host.registered[0].provider.provideMcpServerDefinitions()).toEqual([])
    expect(host.logger.warn).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })

  it('does nothing when the host has no MCP server definition API', () => {
    host.lmAvailable.value = false
    mod.registerAdapterMcpProvider(fakeContext(), () => '/app')
    expect(host.registered).toHaveLength(0)
  })

  it('refreshes the offer when a railsForge.adapters setting changes, and not for other settings', () => {
    mod.registerAdapterMcpProvider(fakeContext(), () => '/app')
    const [emitter] = host.emitters
    host.configListeners[0]({ affectsConfiguration: section => section === 'railsForge.mcp' })
    expect(emitter.fire).not.toHaveBeenCalled()
    host.configListeners[0]({ affectsConfiguration: section => section === 'railsForge.adapters' })
    expect(emitter.fire).toHaveBeenCalledTimes(1)
  })
})
