// Acceptance: RailsForge's own agent loop discovers an external MCP tool, calls it in the project root against a real
// stdio server, and cannot reach a tool the user did not allow. Real SDK client, real process, real loop.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { runAgentLoop, CompleteFn } from '../src/agent/AgentLoop'
import { ExternalServerManager } from '../src/mcp/external/ExternalServerManager'
import { sdkExternalClientFactory } from '../src/mcp/external/SdkExternalClient'
import { parseExternalServers } from '../src/mcp/external/ExternalServerConfig'
import { ExternalMcpBridge } from '../src/mcp/external/ExternalMcpBridge'

const FIXTURE = path.join(__dirname, 'fixtures', 'mcp', 'echo-server.mjs')

/** A model that replies with the given texts in order, recording what it was shown. */
function scriptedModel(replies: string[]) {
  const calls: Array<{ system: string; user: string }> = []
  const complete: CompleteFn = async (system, user) => {
    calls.push({ system, user })
    return { success: true, response: replies[calls.length - 1] ?? 'Done.' }
  }
  return { complete, calls }
}

const toolCall = (name: string, args: object): string =>
  `Checking.\n\`\`\`tool\n${JSON.stringify({ name, arguments: args })}\n\`\`\``

describe('@rails agent loop with an external MCP server', () => {
  let root: string
  let trusted: boolean
  let manager: ExternalServerManager
  let bridge: ExternalMcpBridge

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-agent-')))
    trusted = true
    manager = new ExternalServerManager({
      ...sdkExternalClientFactory(),
      log: () => undefined,
      connectTimeoutMs: 20_000,
      callTimeoutMs: 20_000,
      retryBackoffMs: 60_000,
    })
    bridge = new ExternalMcpBridge(manager, () => trusted, () => undefined)
    const { servers, problems } = parseExternalServers([{
      id: 'echo',
      command: process.execPath,
      args: [FIXTURE],
      allowTools: ['echo'],
    }])
    expect(problems).toEqual([])
    bridge.reconfigure(servers)
  })

  afterEach(async () => {
    await manager.dispose()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('discovers the external tool, shows its signature to the model, and returns its result from the project root', async () => {
    const tools = await bridge.loopToolsFor(root)
    const model = scriptedModel([toolCall('echo__echo', { text: 'hi' }), 'The echo returned the expected text.'])

    const result = await runAgentLoop({ system: 'You are @rails.', prompt: 'Check the echo tool.', complete: model.complete, tools })

    expect(model.calls[0].system).toContain('- echo__echo(text: string) — Echoes text with the working directory it was started in.')
    expect(model.calls[1].user).toContain(`echo:hi:${root}`)
    expect(result).toMatchObject({ success: true, response: 'The echo returned the expected text.', stopped: 'final' })
    expect(result.steps).toEqual([{ tool: 'echo__echo', args: { text: 'hi' }, ok: true, chars: `echo:hi:${root}`.length }])
  }, 60_000)

  it('cannot reach a tool the user did not allow, even though the server provides it', async () => {
    const tools = await bridge.loopToolsFor(root)
    const model = scriptedModel([toolCall('echo__write_file', { path: 'x' }), 'I could not use that tool.'])

    const result = await runAgentLoop({ system: 'You are @rails.', prompt: 'Write a file.', complete: model.complete, tools })

    expect(model.calls[1].user).toContain('There is no tool named "echo__write_file"')
    expect(model.calls[1].user).not.toContain('written')
    expect(result.steps).toEqual([{ tool: 'echo__write_file', args: { path: 'x' }, ok: false, chars: 0 }])
  }, 60_000)

  it('offers no external tool in an untrusted workspace, and starts no process', async () => {
    trusted = false
    const tools = await bridge.loopToolsFor(root)
    expect(tools).toEqual([])
    const model = scriptedModel([toolCall('echo__echo', { text: 'hi' }), 'Answered without it.'])

    await runAgentLoop({ system: 'You are @rails.', prompt: 'Use echo.', complete: model.complete, tools })

    // With no tools offered the loop makes one plain model call and runs no tool protocol: the model is never shown
    // the external tool, so it has nothing to call.
    expect(model.calls).toHaveLength(1)
    expect(model.calls[0].system).not.toContain('echo__echo')
    const [status] = await manager.statusFor(root, false)
    expect(status.state).toBe('untrusted')
  }, 60_000)

  it('keeps answering when the external server fails, and the failure does not reach the loop as a crash', async () => {
    // A server that cannot start: the loop still runs, with no external tools.
    bridge.reconfigure([{ id: 'broken', enabled: true, transport: 'stdio', command: path.join(root, 'no-such-binary'), args: [], env: {}, allowTools: ['echo'], exposeToEditor: false }])
    const tools = await bridge.loopToolsFor(root)
    expect(tools).toEqual([])
    const model = scriptedModel(['A plain answer.'])

    const result = await runAgentLoop({ system: 'You are @rails.', prompt: 'Hello.', complete: model.complete, tools })

    expect(result).toMatchObject({ success: true, response: 'A plain answer.', stopped: 'final' })
  }, 60_000)
})
