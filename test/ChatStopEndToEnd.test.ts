// Stop in the chat, end to end: the chat view, the real agent and loop, the real external tool and its process. Only the
// model is scripted. Pressing Stop while an external tool runs must reach the server (it observes the cancellation), stop
// the process, end the request as cancelled, and make no further model call.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const mockState = vi.hoisted(() => ({ roots: [] as string[] }))

vi.mock('vscode', () => {
  const channel = () => ({
    name: 'RailsForge', append: vi.fn(), appendLine: vi.fn(), replace: vi.fn(), clear: vi.fn(), show: vi.fn(),
    hide: vi.fn(), dispose: vi.fn(), trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  })
  return {
    window: { activeTextEditor: undefined, createOutputChannel: channel, showWarningMessage: vi.fn() },
    workspace: {
      get workspaceFolders() { return mockState.roots.map(fsPath => ({ uri: { fsPath } })) },
      asRelativePath: (p: unknown) => String(p),
      getConfiguration: () => ({ get: () => undefined }),
    },
    commands: { executeCommand: vi.fn(async () => undefined) },
    Uri: { file: (p: string) => ({ fsPath: p, toString: () => p }) },
  }
})

import { RailsChatViewProvider } from '../src/chat/RailsChatViewProvider'
import { RailsAgent } from '../src/agent/RailsAgent'
import { SchemaIndexer } from '../src/rails/SchemaIndexer'
import { RoutesIndexer } from '../src/rails/RoutesIndexer'
import { ExternalServerManager } from '../src/mcp/external/ExternalServerManager'
import { sdkExternalClientFactory } from '../src/mcp/external/SdkExternalClient'
import { parseExternalServers } from '../src/mcp/external/ExternalServerConfig'
import { ExternalMcpBridge } from '../src/mcp/external/ExternalMcpBridge'

const FIXTURE = path.join(__dirname, 'fixtures', 'mcp', 'echo-server.mjs')

describe('Stop in the chat, end to end', () => {
  let root: string
  let manager: ExternalServerManager | undefined

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-chat-stop-')))
    mockState.roots = [root]
  })

  afterEach(async () => {
    await manager?.dispose()
    manager = undefined
    mockState.roots = []
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  it('stopping while an external tool runs stops the tool and its process, ends the request as cancelled, and makes no further model call', async () => {
    manager = new ExternalServerManager({
      ...sdkExternalClientFactory(),
      log: () => undefined,
      connectTimeoutMs: 20_000,
      callTimeoutMs: 60_000,
      retryBackoffMs: 60_000,
    })
    const bridge = new ExternalMcpBridge(manager, () => true, () => undefined)
    const { servers, problems } = parseExternalServers([{ id: 'echo', command: process.execPath, args: [FIXTURE], allowTools: ['slow'], toolRisk: { slow: 'R2' } }])
    expect(problems).toEqual([])
    bridge.reconfigure(servers)

    // The model asks for the slow tool once. It would answer afterwards, but it must not be asked again after Stop.
    let modelCalls = 0
    const askForSlow = `Checking.\n\`\`\`tool\n${JSON.stringify({ name: 'echo__slow', arguments: {} })}\n\`\`\``
    const agent = new RailsAgent(new SchemaIndexer(), new RoutesIndexer(), {
      provider: 'vscode-lm',
      model: 'unused',
      ollamaHost: 'http://127.0.0.1:1',
      vscodeLmRequest: async () => (++modelCalls === 1 ? askForSlow : 'Done.'),
      toolLoop: { enabled: true, maxSteps: 4, verifySyntax: false },
      loopTools: (workspaceRoot, signal) => bridge.loopToolsFor(workspaceRoot ?? root, signal),
    })

    let listener: ((msg: unknown) => unknown) | undefined
    const posted: Array<Record<string, unknown>> = []
    const view = {
      webview: {
        options: {},
        html: '',
        postMessage: vi.fn(async (msg: Record<string, unknown>) => { posted.push(msg); return true }),
        onDidReceiveMessage: (fn: (msg: unknown) => unknown) => { listener = fn; return { dispose() {} } },
      },
    }
    const chat = new RailsChatViewProvider({ fsPath: '/ext' } as never, agent, new SchemaIndexer(), new RoutesIndexer(), () => [])
    chat.resolveWebviewView(view as never)

    const pending = listener?.({ type: 'sendPrompt', prompt: 'Check the slow thing.', includeContext: false })
    const slowIsRunning = (): boolean => fs.existsSync(path.join(root, 'calls.log')) && fs.readFileSync(path.join(root, 'calls.log'), 'utf8').includes('slow')
    await vi.waitFor(() => expect(slowIsRunning()).toBe(true), { timeout: 15_000 })

    await listener?.({ type: 'cancelRequest' })
    await pending

    // The server observed the cancellation: the tool stopped, rather than running out its 20 seconds.
    await vi.waitFor(() => expect(fs.existsSync(path.join(root, 'cancelled.marker'))).toBe(true), { timeout: 10_000 })
    // No model call after Stop: the request ended with the one that asked for the tool.
    expect(modelCalls).toBe(1)
    // The chat reports the request as cancelled, and leaves its streaming state.
    expect(posted.filter(m => m.type === 'appendMessage' && m.sender === 'assistant')).toEqual([
      { type: 'appendMessage', sender: 'assistant', text: 'Cancelled.', success: false },
    ])
    expect(posted.at(-1)).toEqual({ type: 'stopStreaming' })
    // The process was stopped, not left running and not failed, and it was not started again to answer a status check.
    await vi.waitFor(async () => {
      const [status] = await manager!.statusFor(root, true)
      expect(status.state).toBe('stopped')
    }, { timeout: 10_000 })
    expect(fs.readFileSync(path.join(root, 'started.log'), 'utf8').trim().split('\n')).toHaveLength(1)
  }, 60_000)
})
