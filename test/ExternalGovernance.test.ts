// Risk classification and audit diagnostics, against the real stdio fixture. A server cannot lower a tool's risk: its hints
// (here, readOnlyHint on `echo`) grant nothing, and only the user's `toolRisk` setting does. A failed call is audited with
// its outcome, code and duration, and never with argument values.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { exposeTools, RemoteToolDescriptor } from '../src/mcp/external/ExternalTools'
import { ExternalServerManager } from '../src/mcp/external/ExternalServerManager'
import { sdkExternalClientFactory } from '../src/mcp/external/SdkExternalClient'
import { parseExternalServers } from '../src/mcp/external/ExternalServerConfig'
import { ExternalMcpBridge } from '../src/mcp/external/ExternalMcpBridge'
import { AUDIT_RELATIVE_PATH } from '../src/mcp/audit/McpAuditRecorder'

const FIXTURE = path.join(__dirname, 'fixtures', 'mcp', 'echo-server.mjs')

describe('risk: a server cannot lower the risk of a tool', () => {
  it('a server hint on an undeclared tool does not make it R2 or any other level: it stays R3', () => {
    const listed = [{
      name: 'lookup',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    } as unknown as RemoteToolDescriptor]
    const { tools } = exposeTools('srv', listed, ['lookup'])
    expect(tools[0].risk).toBe('R3')
  })

  it('against the real server: echo declares readOnlyHint and is still R3 until the user declares it R2', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-risk-')))
    const manager = new ExternalServerManager({
      ...sdkExternalClientFactory(),
      log: () => undefined,
      connectTimeoutMs: 20_000,
      callTimeoutMs: 20_000,
      retryBackoffMs: 60_000,
    })
    try {
      const undeclared = parseExternalServers([{ id: 'echo', command: process.execPath, args: [FIXTURE], allowTools: ['echo'] }])
      expect(undeclared.problems).toEqual([])
      manager.configure(undeclared.servers)
      const before = await manager.toolsFor(root, true)
      expect(before.find(t => t.remoteName === 'echo')?.risk).toBe('R3')

      // Declaring the risk is the user's act, and it changes the configuration, so the process is restarted with it.
      const declared = parseExternalServers([{ id: 'echo', command: process.execPath, args: [FIXTURE], allowTools: ['echo'], toolRisk: { echo: 'R2' } }])
      expect(declared.problems).toEqual([])
      manager.configure(declared.servers)
      const after = await manager.toolsFor(root, true)
      expect(after.find(t => t.remoteName === 'echo')?.risk).toBe('R2')
    } finally {
      await manager.dispose()
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  }, 60_000)
})

describe('audit: a failed call is recorded with its outcome, code and duration, and no values', () => {
  let root: string
  let manager: ExternalServerManager | undefined

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-audit-')))
  })

  afterEach(async () => {
    await manager?.dispose()
    manager = undefined
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  it('a server-side failure is finished with outcome failure, its code and a duration, and the argument value is not written', async () => {
    manager = new ExternalServerManager({ ...sdkExternalClientFactory(), log: () => undefined, connectTimeoutMs: 20_000, callTimeoutMs: 20_000 })
    const bridge = new ExternalMcpBridge(manager, () => true, () => undefined)
    const { servers, problems } = parseExternalServers([{ id: 'echo', command: process.execPath, args: [FIXTURE], allowTools: ['fail'], toolRisk: { fail: 'R2' } }])
    expect(problems).toEqual([])
    bridge.reconfigure(servers)
    const [failing] = await bridge.loopToolsFor(root)

    // `fail` takes no arguments; the extra one is still a named argument of the call, so it is audited by name only.
    await expect(failing.run({ note: 'secret-value-123' })).rejects.toMatchObject({ code: 'SERVER_ERROR', message: 'boom' })

    const file = path.join(root, AUDIT_RELATIVE_PATH)
    const records = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const finished = records.find(r => r.phase === 'finished')
    expect(finished).toMatchObject({
      tool: 'echo__fail',
      risk: 'R2',
      outcome: 'failure',
      errorCode: 'SERVER_ERROR',
      argumentNames: ['note'],
    })
    expect(typeof finished?.durationMs).toBe('number')
    expect(finished?.durationMs).toBeGreaterThanOrEqual(0)
    expect(fs.readFileSync(file, 'utf8')).not.toContain('secret-value-123')
  }, 60_000)
})
