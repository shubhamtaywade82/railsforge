// Acceptance for the MCP gateway, against the real stdio fixture server through the production SDK client, the gateway,
// invokeTool, and the agent loop. The fixture writes what reached it into the project root, so each claim below is
// checked against the server's own record, not against what RailsForge reports.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { runAgentLoop, describeTools, CompleteFn, LoopTool } from '../src/agent/AgentLoop'
import { ExternalServerManager } from '../src/mcp/external/ExternalServerManager'
import { sdkExternalClientFactory } from '../src/mcp/external/SdkExternalClient'
import { parseExternalServers } from '../src/mcp/external/ExternalServerConfig'
import { ExternalMcpBridge } from '../src/mcp/external/ExternalMcpBridge'
import type { ApprovalPort, ApprovalRequest } from '../src/mcp/policy/ToolInvocation'
import { AUDIT_RELATIVE_PATH } from '../src/mcp/audit/McpAuditRecorder'

const FIXTURE = path.join(__dirname, 'fixtures', 'mcp', 'echo-server.mjs')
const exists = (root: string, name: string): boolean => fs.existsSync(path.join(root, name))
const serverRecord = (root: string): string[] => (exists(root, 'calls.log') ? fs.readFileSync(path.join(root, 'calls.log'), 'utf8').trim().split('\n') : [])
const auditRecords = (root: string): Array<Record<string, unknown>> => fs.readFileSync(path.join(root, AUDIT_RELATIVE_PATH), 'utf8').trim().split('\n').map(line => JSON.parse(line))

function answers(...replies: Array<'granted' | 'denied'>): ApprovalPort & { request: ReturnType<typeof vi.fn> } {
  const queue = [...replies]
  return { request: vi.fn(async () => queue.shift() ?? 'denied') } as never
}

function scriptedModel(replies: string[]): { complete: CompleteFn; calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = []
  return {
    calls,
    complete: async (system, user) => {
      calls.push({ system, user })
      return { success: true, response: replies[calls.length - 1] ?? 'Done.' }
    },
  }
}

const call = (name: string, args: object): string => `Working.\n\`\`\`tool\n${JSON.stringify({ name, arguments: args })}\n\`\`\``

describe('MCP gateway acceptance (real stdio server)', () => {
  let root: string
  let manager: ExternalServerManager
  let trusted: boolean
  let bridge: ExternalMcpBridge
  let logs: string[]

  async function setUp(options: { approval?: ApprovalPort; nativeNames?: ReadonlySet<string>; allowTools?: string[]; toolRisk?: Record<string, 'R2' | 'R3'> } = {}): Promise<Map<string, LoopTool>> {
    manager = new ExternalServerManager({
      ...sdkExternalClientFactory(),
      log: () => undefined,
      connectTimeoutMs: 20_000,
      callTimeoutMs: 20_000,
      retryBackoffMs: 60_000,
    })
    bridge = new ExternalMcpBridge(manager, () => trusted, message => logs.push(message), {
      approval: options.approval,
      nativeNames: options.nativeNames,
    })
    const { servers, problems } = parseExternalServers([{
      id: 'echo',
      command: process.execPath,
      args: [FIXTURE],
      allowTools: options.allowTools ?? ['echo', 'write_file', 'fail', 'exit_now'],
      // write_file is deliberately left at its default, R3, unless a test says otherwise.
      toolRisk: { echo: 'R2', fail: 'R2', exit_now: 'R2', ...(options.toolRisk ?? {}) },
    }])
    expect(problems).toEqual([])
    bridge.reconfigure(servers)
    const tools = await bridge.loopToolsFor(root)
    return new Map(tools.map(t => [t.name, t]))
  }

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-gateway-')))
    trusted = true
    logs = []
  })

  afterEach(async () => {
    await manager.dispose()
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  it('discovers the external tools with their signatures, namespaced by server', async () => {
    const tools = await setUp({ approval: answers('granted') })
    expect([...tools.keys()].sort()).toEqual(['echo__echo', 'echo__exit_now', 'echo__fail', 'echo__write_file'])
    const described = describeTools([...tools.values()])
    expect(described).toContain('- echo__write_file(path: string)')
  }, 60_000)

  it('an R3 call cannot run without approval: it is refused, and nothing reaches the server', async () => {
    const tools = await setUp()
    await expect(tools.get('echo__write_file')!.run({ path: 'app/models/order.rb' })).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
      message: expect.stringContaining('echo__write_file was not run'),
    })
    expect(exists(root, 'written.marker')).toBe(false)
    expect(serverRecord(root)).toEqual([]) // the server recorded no invocation
  }, 60_000)

  it('an R3 call runs only when the user approves that one call, and the next call asks again', async () => {
    const approval = answers('granted', 'denied')
    const tools = await setUp({ approval })
    const write = tools.get('echo__write_file')!

    await expect(write.run({ path: 'app/models/order.rb' })).resolves.toBe('written')
    expect(exists(root, 'written.marker')).toBe(true)
    expect(serverRecord(root)).toEqual(['write_file'])

    await expect(write.run({ path: 'app/models/second.rb' })).rejects.toMatchObject({ code: 'APPROVAL_DENIED' })
    expect(approval.request).toHaveBeenCalledTimes(2)
    expect(serverRecord(root)).toEqual(['write_file'])
  }, 60_000)

  it('the approval shows the tool, workspace, operation and arguments the user is allowing', async () => {
    const approval = answers('denied')
    const tools = await setUp({ approval })
    await expect(tools.get('echo__write_file')!.run({ path: 'app/models/order.rb' })).rejects.toMatchObject({ code: 'APPROVAL_DENIED' })
    const request = approval.request.mock.calls[0][0] as ApprovalRequest
    expect(request).toMatchObject({
      tool: 'echo__write_file',
      risk: 'R3',
      source: 'host',
      workspaceRoot: root,
      argumentNames: ['path'],
    })
    expect(request.operation).toContain('echo: write_file')
    expect(request.argumentPreview).toContain('app/models/order.rb')
  }, 60_000)

  it('a denied call never reaches the server', async () => {
    const tools = await setUp({ approval: answers('denied') })
    await expect(tools.get('echo__write_file')!.run({ path: 'x' })).rejects.toMatchObject({ code: 'APPROVAL_DENIED' })
    expect(exists(root, 'written.marker')).toBe(false)
    expect(serverRecord(root)).toEqual([])
  }, 60_000)

  it('a malformed call never reaches the server and is not put to the user', async () => {
    const approval = answers('granted')
    const tools = await setUp({ approval })
    await expect(tools.get('echo__write_file')!.run({})).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS', message: expect.stringContaining('path: is required') })
    await expect(tools.get('echo__write_file')!.run({ path: 42 } as never)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    expect(approval.request).not.toHaveBeenCalled()
    expect(serverRecord(root)).toEqual([])
  }, 60_000)

  it('the agent receives the refusal as a structured, coded step, and the loop still answers', async () => {
    const tools = await setUp({ approval: answers('denied') })
    const model = scriptedModel([call('echo__write_file', { path: 'x' }), 'I could not write the file, so I answered without it.'])
    const result = await runAgentLoop({ system: 'You are @rails.', prompt: 'Write it.', complete: model.complete, tools: [...tools.values()] })

    expect(model.calls[1].user).toContain('Error running echo__write_file [APPROVAL_DENIED]')
    expect(result).toMatchObject({ success: true, stopped: 'final', response: 'I could not write the file, so I answered without it.' })
    expect(result.steps).toEqual([{ tool: 'echo__write_file', args: { path: 'x' }, ok: false, chars: expect.any(Number), code: 'APPROVAL_DENIED' }])
  }, 60_000)

  it('an approved call is audited as started and finished with the grant, and the trail holds no argument values', async () => {
    const tools = await setUp({ approval: answers('granted') })
    await tools.get('echo__write_file')!.run({ path: 'secret/path/Order.rb' })
    const records = auditRecords(root).filter(r => r.tool === 'echo__write_file')
    expect(records.map(r => [r.phase, r.approval, r.outcome])).toEqual([['started', 'granted', undefined], ['finished', 'granted', 'success']])
    expect(records[0]).toMatchObject({ risk: 'R3', source: 'host', argumentNames: ['path'] })
    expect(fs.readFileSync(path.join(root, AUDIT_RELATIVE_PATH), 'utf8')).not.toContain('secret/path/Order.rb')
  }, 60_000)

  it('a server crash ends that tool only: the loop carries on and answers', async () => {
    const tools = await setUp({ approval: answers() })
    const model = scriptedModel([call('echo__exit_now', {}), call('echo__fail', {}), 'Answered after the crash.'])
    const result = await runAgentLoop({ system: 'You are @rails.', prompt: 'Try the server.', complete: model.complete, tools: [...tools.values()] })

    expect(result).toMatchObject({ success: true, stopped: 'final', response: 'Answered after the crash.' })
    expect(result.steps.at(-1)).toMatchObject({ tool: 'echo__fail', ok: false, code: expect.any(String) })
  }, 60_000)

  it('revoking trust takes effect at once: an approved R3 call is refused and no prompt is shown', async () => {
    const approval = answers('granted')
    const tools = await setUp({ approval })
    trusted = false
    await expect(tools.get('echo__write_file')!.run({ path: 'x' })).rejects.toMatchObject({ code: 'WORKSPACE_UNTRUSTED' })
    expect(approval.request).not.toHaveBeenCalled()
    expect(serverRecord(root)).toEqual([])
  }, 60_000)

  it('an untrusted workspace offers no external tool and starts no process', async () => {
    trusted = false
    const approval = answers('granted')
    manager = new ExternalServerManager({ ...sdkExternalClientFactory(), log: () => undefined })
    bridge = new ExternalMcpBridge(manager, () => false, () => undefined, { approval })
    bridge.reconfigure(parseExternalServers([{ id: 'echo', command: process.execPath, args: [FIXTURE], allowTools: ['echo'] }]).servers)
    expect(await bridge.loopToolsFor(root)).toEqual([])
    expect(approval.request).not.toHaveBeenCalled()
    expect(exists(root, 'started.log')).toBe(false)
  }, 60_000)

  it('an external tool may not take the name of one of RailsForge\'s own tools', async () => {
    const tools = await setUp({ approval: answers('granted'), nativeNames: new Set(['echo__echo']) })
    expect(tools.has('echo__echo')).toBe(false)
    expect(tools.has('echo__write_file')).toBe(true)
    expect(logs).toEqual([expect.stringContaining('"echo__echo" is not offered')])
  }, 60_000)
})
