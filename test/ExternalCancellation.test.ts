// Cancellation and process lifecycle, against the real stdio fixture server. "started.log" in the project root has one
// line per process start, so each test can tell whether a process was stopped and started again.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ExternalServerManager } from '../src/mcp/external/ExternalServerManager'
import { sdkExternalClientFactory } from '../src/mcp/external/SdkExternalClient'
import { parseExternalServers } from '../src/mcp/external/ExternalServerConfig'
import { ExternalMcpBridge } from '../src/mcp/external/ExternalMcpBridge'
import { LoopTool, runAgentLoop, CompleteFn } from '../src/agent/AgentLoop'

const FIXTURE = path.join(__dirname, 'fixtures', 'mcp', 'echo-server.mjs')

describe('cancellation and process lifecycle', () => {
  let root: string
  let manager: ExternalServerManager
  let bridge: ExternalMcpBridge
  let tools: LoopTool[]

  const starts = (): number => (fs.existsSync(path.join(root, 'started.log')) ? fs.readFileSync(path.join(root, 'started.log'), 'utf8').trim().split('\n').length : 0)
  const tool = (name: string): LoopTool => {
    const found = tools.find(t => t.name === name)
    if (!found) {throw new Error(`tool ${name} was not offered`)}
    return found
  }

  async function setUp(callTimeoutMs: number, allowTools: string[]): Promise<void> {
    manager = new ExternalServerManager({
      ...sdkExternalClientFactory(),
      log: () => undefined,
      connectTimeoutMs: 20_000,
      callTimeoutMs,
      retryBackoffMs: 60_000,
    })
    bridge = new ExternalMcpBridge(manager, () => true, () => undefined)
    // Declared low-risk, so these tests exercise cancellation and not approval (approval has its own acceptance tests).
    const toolRisk = Object.fromEntries(allowTools.map(name => [name, 'R2' as const]))
    const { servers, problems } = parseExternalServers([{ id: 'echo', command: process.execPath, args: [FIXTURE], allowTools, toolRisk }])
    expect(problems).toEqual([])
    bridge.reconfigure(servers)
    tools = await bridge.loopToolsFor(root)
  }

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-cancel-')))
  })

  afterEach(async () => {
    await manager.dispose()
    // A stopped process may still be writing its log for a moment; retry instead of racing it.
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  it('cancelling a running call reaches the server, which observes the cancellation', async () => {
    await setUp(60_000, ['slow'])
    const controller = new AbortController()
    const started = Date.now()
    const running = tool('echo__slow').run({}, controller.signal)
    setTimeout(() => controller.abort(), 400)

    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(Date.now() - started).toBeLessThan(5_000)
    await expect.poll(() => fs.existsSync(path.join(root, 'cancelled.marker')), { timeout: 10_000 }).toBe(true)
  }, 60_000)

  it('cancelling the only call in flight stops the process, and the next call starts a fresh one', async () => {
    await setUp(60_000, ['slow', 'echo'])
    const controller = new AbortController()
    const running = tool('echo__slow').run({}, controller.signal)
    setTimeout(() => controller.abort(), 400)
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(starts()).toBe(1)

    // The process was stopped, not held back: the next use starts it again at once.
    const next = await tool('echo__echo').run({ text: 'again' })
    expect(next).toContain('echo:again:')
    expect(starts()).toBe(2)
  }, 60_000)

  it('cancelling one of two concurrent calls keeps the process for the other, and stops it only when the last one is cancelled', async () => {
    await setUp(60_000, ['slow'])
    const first = new AbortController()
    const second = new AbortController()
    const a = tool('echo__slow').run({}, first.signal)
    const b = tool('echo__slow').run({}, second.signal)
    setTimeout(() => first.abort(), 400)
    await expect(a).rejects.toMatchObject({ code: 'CANCELLED' })

    // B is still running on the same process: it has not been cancelled, and the process was not restarted.
    const bSettled = await Promise.race([b.then(() => 'resolved', () => 'rejected'), new Promise(resolve => setTimeout(() => resolve('pending'), 800))])
    expect(bSettled).toBe('pending')
    expect(starts()).toBe(1)

    setTimeout(() => second.abort(), 50)
    await expect(b).rejects.toMatchObject({ code: 'CANCELLED' })
    await expect.poll(() => starts(), { timeout: 5_000 }).toBe(1)
  }, 60_000)

  it('a timeout stops the process and holds it back for the backoff, because its state is unknown', async () => {
    await setUp(400, ['slow', 'echo'])
    await expect(tool('echo__slow').run({})).rejects.toMatchObject({ code: 'TIMEOUT' })

    // Held back: no restart inside the backoff, so the next call is refused rather than starting a new process.
    await expect(tool('echo__echo').run({ text: 'x' })).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
    expect(starts()).toBe(1)
  }, 60_000)

  it('a server error is reported with its code, and the process keeps running for the next call', async () => {
    await setUp(60_000, ['fail', 'echo'])
    await expect(tool('echo__fail').run({})).rejects.toMatchObject({ code: 'SERVER_ERROR', message: 'boom' })
    expect(await tool('echo__echo').run({ text: 'still-up' })).toContain('echo:still-up:')
    expect(starts()).toBe(1)
  }, 60_000)

  it('cancelling an agent operation stops the running tool and ends the loop as cancelled, with the code recorded', async () => {
    await setUp(60_000, ['slow'])
    const controller = new AbortController()
    const replies = [`Checking.\n\`\`\`tool\n${JSON.stringify({ name: 'echo__slow', arguments: {} })}\n\`\`\``, 'never reached']
    const complete: CompleteFn = async () => ({ success: true, response: replies.shift() ?? 'never reached' })
    setTimeout(() => controller.abort(), 400)

    const result = await runAgentLoop({
      system: 'You are @rails.',
      prompt: 'Wait for the slow tool.',
      complete,
      tools,
      signal: controller.signal,
    })

    expect(result).toMatchObject({ success: false, stopped: 'cancelled', response: 'Cancelled.' })
    expect(result.steps).toEqual([{ tool: 'echo__slow', args: {}, ok: false, chars: expect.any(Number), code: 'CANCELLED' }])
    await expect.poll(() => fs.existsSync(path.join(root, 'cancelled.marker')), { timeout: 10_000 }).toBe(true)
  }, 60_000)
})
