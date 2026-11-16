import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExternalServerManager, ExternalClient, ExternalTransport, TransportLaunch } from '../src/mcp/external/ExternalServerManager'
import { ExternalServerSpec } from '../src/mcp/external/ExternalServerConfig'
import { RemoteToolDescriptor } from '../src/mcp/external/ExternalTools'
import { renderStatusMarkdown } from '../src/mcp/external/ExternalMcpBridge'

const spec = (over: Partial<ExternalServerSpec> = {}): ExternalServerSpec => ({
  id: 'rails',
  enabled: true,
  transport: 'stdio',
  command: 'rails-tool',
  args: [],
  env: {},
  allowTools: ['get_schema'],
  ...over,
})

const listed: RemoteToolDescriptor[] = [
  { name: 'get_schema', inputSchema: { type: 'object', properties: { model: { type: 'string' } } } },
  { name: 'write_file', inputSchema: { type: 'object' } },
]

/** A fake transport whose exit the test can trigger, and which records that it was closed. */
function fakeTransport() {
  const transport = {
    closed: false,
    onclose: undefined as (() => void) | undefined,
    close: vi.fn(async () => { transport.closed = true }),
    exit() { transport.onclose?.() },
  }
  return transport
}

interface FakeOptions {
  connect?: () => Promise<void>
  list?: () => Promise<RemoteToolDescriptor[]>
  call?: (name: string) => Promise<{ text: string; isError: boolean }>
}

function fakeClient(transports: ReturnType<typeof fakeTransport>[], options: FakeOptions = {}) {
  // Each client remembers the transport it connected, so closing it closes that process and no other.
  let own: ReturnType<typeof fakeTransport> | undefined
  const client = {
    closed: false,
    connect: vi.fn(async (transport: ExternalTransport) => {
      own = transport as ReturnType<typeof fakeTransport>
      transports.push(own)
      if (options.connect) {await options.connect()}
    }),
    listTools: vi.fn(options.list ?? (async () => listed)),
    callTool: vi.fn(options.call ?? (async (name: string) => ({ text: `ran ${name}`, isError: false }))),
    close: vi.fn(async () => {
      client.closed = true
      await own?.close()
    }),
  }
  return client
}

function harness(options: FakeOptions & { retryBackoffMs?: number; connectTimeoutMs?: number; now?: () => number } = {}) {
  const transports: ReturnType<typeof fakeTransport>[] = []
  const clients: ReturnType<typeof fakeClient>[] = []
  const launches: TransportLaunch[] = []
  const logs: string[] = []
  let clock = 1_000
  const manager = new ExternalServerManager({
    createClient: async () => {
      const client = fakeClient(transports, options)
      clients.push(client)
      return client as unknown as ExternalClient
    },
    createTransport: async launch => {
      launches.push(launch)
      return fakeTransport() as unknown as ExternalTransport
    },
    now: options.now ?? (() => clock),
    log: (_level, message) => logs.push(message),
    retryBackoffMs: options.retryBackoffMs ?? 30_000,
    connectTimeoutMs: options.connectTimeoutMs ?? 1_000,
  })
  return { manager, transports, clients, launches, logs, advance: (ms: number) => { clock += ms } }
}

describe('ExternalServerManager: starting servers', () => {
  it('starts nothing in an untrusted workspace, not even a process', async () => {
    const h = harness()
    h.manager.configure([spec()])
    await expect(h.manager.toolsFor('/project', false)).resolves.toEqual([])
    expect(h.launches).toEqual([])
    expect(h.clients).toEqual([])
  })

  it('starts a server with the project root as its working directory and only the configured environment', async () => {
    const h = harness()
    h.manager.configure([spec({ env: { RF_TOKEN_NAME: 'x' } })])
    await h.manager.toolsFor('/projects/app', true)
    expect(h.launches).toEqual([{ command: 'rails-tool', args: [], cwd: '/projects/app', env: { RF_TOKEN_NAME: 'x' } }])
  })

  it('offers only the allowed tools, namespaced by server', async () => {
    const h = harness()
    h.manager.configure([spec()])
    const tools = await h.manager.toolsFor('/project', true)
    expect(tools.map(t => t.exposedName)).toEqual(['rails__get_schema'])
  })

  it('reuses one session for the same server and root', async () => {
    const h = harness()
    h.manager.configure([spec()])
    await h.manager.toolsFor('/project', true)
    await h.manager.toolsFor('/project', true)
    expect(h.launches).toHaveLength(1)
  })

  it('starts one process per project root, so a multi-root workspace gets the right project', async () => {
    const h = harness()
    h.manager.configure([spec()])
    await Promise.all([h.manager.toolsFor('/a', true), h.manager.toolsFor('/b', true)])
    expect(h.launches.map(l => l.cwd).sort()).toEqual(['/a', '/b'])
  })

  it('shares one connection attempt between concurrent callers', async () => {
    const h = harness()
    h.manager.configure([spec()])
    await Promise.all([h.manager.toolsFor('/project', true), h.manager.toolsFor('/project', true), h.manager.toolsFor('/project', true)])
    expect(h.launches).toHaveLength(1)
  })

  it('does not start a disabled server', async () => {
    const h = harness()
    h.manager.configure([spec({ enabled: false })])
    await expect(h.manager.toolsFor('/project', true)).resolves.toEqual([])
    expect(h.launches).toEqual([])
  })
})

describe('ExternalServerManager: failures and recovery', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => { h = harness() })

  it('marks a server failed when connecting fails, and does not retry during the backoff', async () => {
    const failing = harness({ connect: async () => { throw new Error('spawn ENOENT') } })
    failing.manager.configure([spec()])
    await expect(failing.manager.toolsFor('/project', true)).resolves.toEqual([])
    await expect(failing.manager.toolsFor('/project', true)).resolves.toEqual([])
    expect(failing.launches).toHaveLength(1)
    expect(failing.logs.some(line => line.includes('spawn ENOENT'))).toBe(true)
  })

  it('retries once the backoff has passed', async () => {
    let attempts = 0
    let clock = 1_000
    const flaky = harness({
      connect: async () => { attempts++; if (attempts === 1) {throw new Error('first try failed')} },
      now: () => clock,
    })
    flaky.manager.configure([spec()])
    await flaky.manager.toolsFor('/project', true) // attempt 1 fails at t=1000
    await flaky.manager.toolsFor('/project', true) // inside the 30 s backoff: no new attempt
    expect(flaky.launches).toHaveLength(1)
    clock += 30_000 // backoff elapsed
    const tools = await flaky.manager.toolsFor('/project', true) // attempt 2 succeeds
    expect(flaky.launches).toHaveLength(2)
    expect(tools).toHaveLength(1)
  })

  it('times out a connection that never completes, and reports the timeout', async () => {
    const hung = harness({ connect: () => new Promise(() => {}), connectTimeoutMs: 20 })
    hung.manager.configure([spec()])
    await expect(hung.manager.toolsFor('/project', true)).resolves.toEqual([])
    expect(hung.logs.some(line => line.includes('timed out after 20 ms'))).toBe(true)
  })

  it('marks a session failed when its process exits, clears its tools, and closes the transport', async () => {
    h.manager.configure([spec()])
    expect(await h.manager.toolsFor('/project', true)).toHaveLength(1)
    h.transports[0].exit()
    expect(h.transports[0].close).toHaveBeenCalled()
    await expect(h.manager.toolsFor('/project', true)).resolves.toEqual([])
    expect(h.logs.some(line => line.includes('the server process exited'))).toBe(true)
  })

  it('does not restart a server when a configuration change leaves its entry unchanged', async () => {
    h.manager.configure([spec()])
    await h.manager.toolsFor('/project', true)
    h.manager.configure([spec()])
    await h.manager.toolsFor('/project', true)
    expect(h.launches).toHaveLength(1)
  })
})

describe('ExternalServerManager: calls', () => {
  it('calls an exposed tool and returns its text', async () => {
    const h = harness()
    h.manager.configure([spec()])
    await h.manager.toolsFor('/project', true)
    await expect(h.manager.callTool('rails', '/project', 'get_schema', { model: 'Order' })).resolves.toBe('ran get_schema')
    expect(h.clients[0].callTool).toHaveBeenCalledWith('get_schema', { model: 'Order' }, expect.any(Number))
  })

  it('refuses to call a tool the session did not expose, even when the server has it', async () => {
    const h = harness()
    h.manager.configure([spec()])
    await h.manager.toolsFor('/project', true)
    await expect(h.manager.callTool('rails', '/project', 'write_file', {})).rejects.toThrow('does not expose "write_file"')
    expect(h.clients[0].callTool).not.toHaveBeenCalled()
  })

  it('refuses a call when no session is connected for that root', async () => {
    const h = harness()
    h.manager.configure([spec()])
    await expect(h.manager.callTool('rails', '/project', 'get_schema', {})).rejects.toThrow('rails is not connected.')
  })

  it('reports a server-side error as a failed call', async () => {
    const h = harness({ call: async () => ({ text: 'database locked', isError: true }) })
    h.manager.configure([spec()])
    await h.manager.toolsFor('/project', true)
    await expect(h.manager.callTool('rails', '/project', 'get_schema', {})).rejects.toThrow('database locked')
  })
})

describe('ExternalServerManager: configuration changes and shutdown', () => {
  it('closes the process of a server that is removed from the configuration', async () => {
    const h = harness()
    h.manager.configure([spec()])
    await h.manager.toolsFor('/project', true)
    h.manager.configure([])
    await vi.waitFor(() => expect(h.transports[0].close).toHaveBeenCalled())
    await expect(h.manager.toolsFor('/project', true)).resolves.toEqual([])
  })

  it('restarts a server whose command or allowed tools changed', async () => {
    const h = harness()
    h.manager.configure([spec()])
    await h.manager.toolsFor('/project', true)
    h.manager.configure([spec({ allowTools: ['get_schema', 'write_file'] })])
    await vi.waitFor(() => expect(h.transports[0].close).toHaveBeenCalled())
    const tools = await h.manager.toolsFor('/project', true)
    expect(tools.map(t => t.remoteName).sort()).toEqual(['get_schema', 'write_file'])
    expect(h.launches).toHaveLength(2)
  })

  it('closes a connection that finishes after its server was removed, so it cannot leak a process', async () => {
    let release: () => void = () => {}
    const h = harness({ connect: () => new Promise<void>(resolve => { release = resolve }) })
    h.manager.configure([spec()])
    const pending = h.manager.toolsFor('/project', true)
    await vi.waitFor(() => expect(h.transports).toHaveLength(1))
    h.manager.configure([])
    release()
    await pending
    await vi.waitFor(() => expect(h.transports[0].close).toHaveBeenCalled())
  })

  it('dispose closes every process', async () => {
    const h = harness()
    h.manager.configure([spec({ id: 'one' }), spec({ id: 'two', allowTools: [] })])
    await h.manager.toolsFor('/project', true)
    await h.manager.dispose()
    expect(h.transports.every(t => t.closed)).toBe(true)
    await expect(h.manager.dispose()).resolves.toBeUndefined()
  })
})

describe('ExternalServerManager: status for the test command', () => {
  it('reports disabled and untrusted servers without starting them', async () => {
    const h = harness()
    h.manager.configure([spec({ id: 'off', enabled: false }), spec({ id: 'on' })])
    const statuses = await h.manager.statusFor('/project', false)
    expect(statuses).toEqual([
      { id: 'off', state: 'disabled', tools: [], problems: [] },
      { id: 'on', state: 'untrusted', tools: [], problems: [] },
    ])
    expect(h.launches).toEqual([])
  })

  it('reports a ready server with the tools it offers, and a problem for an allowed name it lacks', async () => {
    const h = harness()
    h.manager.configure([spec({ allowTools: ['get_schema', 'drop_table'] })])
    const [status] = await h.manager.statusFor('/project', true)
    expect(status.state).toBe('ready')
    expect(status.tools).toEqual(['get_schema'])
    expect(status.problems).toEqual([expect.stringContaining('"drop_table", which rails does not provide')])
  })

  it('reports a failed server with its reason', async () => {
    const h = harness({ connect: async () => { throw new Error('no such file') } })
    h.manager.configure([spec()])
    const [status] = await h.manager.statusFor('/project', true)
    expect(status).toMatchObject({ state: 'failed', failure: 'no such file' })
  })
})

describe('renderStatusMarkdown', () => {
  it('shows each state, the offered tools as namespaced names, and configuration problems', () => {
    const text = renderStatusMarkdown({
      root: '/project',
      trusted: true,
      statuses: [
        { id: 'rails', state: 'ready', tools: ['get_schema'], problems: [] },
        { id: 'gems', state: 'failed', tools: [], problems: [], failure: 'spawn ENOENT' },
      ],
      problems: [{ index: 2, id: 'bad', message: 'id must be lowercase.' }],
    })
    expect(text).toContain('| rails | ready | `rails__get_schema` |')
    expect(text).toContain('| gems | failed | — | failed: spawn ENOENT |')
    expect(text).toContain('- Entry 3 (bad): id must be lowercase.')
    expect(text).toContain('Workspace trusted: yes')
  })

  it('says why nothing starts in an untrusted workspace, and never prints environment values', () => {
    const text = renderStatusMarkdown({ root: '/p', trusted: false, statuses: [], problems: [] })
    expect(text).toContain('Servers do not start until the workspace is trusted.')
    expect(text).toContain('No servers are configured')
  })

  it('escapes table separators in notes', () => {
    const text = renderStatusMarkdown({ root: '/p', trusted: true, statuses: [{ id: 'x', state: 'failed', tools: [], problems: ['a | b'], failure: undefined }], problems: [] })
    expect(text).toContain('a \\| b')
  })
})
