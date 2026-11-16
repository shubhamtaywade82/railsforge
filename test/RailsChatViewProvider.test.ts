// The chat view's stop control. A request is cancellable from the webview: the agent receives the signal, the answer is
// reported as cancelled, and the view leaves its streaming state. A second request is refused while one runs. The view
// leaves streaming state even when the agent fails.
import { describe, it, expect, vi } from 'vitest'

vi.mock('vscode', () => {
  const channel = () => ({
    name: 'RailsForge', append: vi.fn(), appendLine: vi.fn(), replace: vi.fn(), clear: vi.fn(), show: vi.fn(),
    hide: vi.fn(), dispose: vi.fn(), trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  })
  return {
    window: { activeTextEditor: undefined, createOutputChannel: channel, showWarningMessage: vi.fn() },
    workspace: { workspaceFolders: undefined, asRelativePath: (p: unknown) => String(p), getConfiguration: () => ({ get: () => undefined }) },
    commands: { executeCommand: vi.fn(async () => undefined) },
    Uri: { file: (p: string) => ({ fsPath: p, toString: () => p }) },
  }
})

import { RailsChatViewProvider } from '../src/chat/RailsChatViewProvider'

interface Posted { type: string; [key: string]: unknown }

function setUp(run: (prompt: string, context: { signal?: AbortSignal }) => Promise<{ success: boolean; response: string }>) {
  let listener: ((msg: unknown) => unknown) | undefined
  const posted: Posted[] = []
  const view = {
    webview: {
      options: {},
      html: '',
      postMessage: vi.fn(async (msg: Posted) => { posted.push(msg); return true }),
      onDidReceiveMessage: (fn: (msg: unknown) => unknown) => { listener = fn; return { dispose() {} } },
    },
  }
  const agent = {
    run: vi.fn(run),
    getProviderStatus: vi.fn(async () => ({ state: 'reachable' })),
  }
  const provider = new RailsChatViewProvider(
    { fsPath: '/ext' } as never,
    agent as never,
    { getAllTables: () => [] } as never,
    { getAllRoutes: () => [] } as never,
    () => [],
  )
  provider.resolveWebviewView(view as never)
  const send = (msg: Record<string, unknown>): Promise<unknown> => Promise.resolve(listener?.(msg))
  return { agent, posted, send, view }
}

const sendPrompt = (prompt: string) => ({ type: 'sendPrompt', prompt, includeContext: false })

describe('the chat stop control', () => {
  it('stops the request: the agent receives the signal, the answer is reported as cancelled, and streaming ends', async () => {
    const h = setUp((_prompt, context) => new Promise(resolve => {
      context.signal?.addEventListener('abort', () => resolve({ success: true, response: 'a partial answer' }), { once: true })
    }))

    const pending = h.send(sendPrompt('explain the order model'))
    await vi.waitFor(() => expect(h.agent.run).toHaveBeenCalled())
    expect(h.posted).toContainEqual({ type: 'startStreaming' })

    await h.send({ type: 'cancelRequest' })
    await pending

    const context = h.agent.run.mock.calls[0][1] as { signal: AbortSignal }
    expect(context.signal.aborted).toBe(true)
    expect(h.posted.filter(m => m.type === 'appendMessage' && m.sender === 'assistant')).toEqual([
      { type: 'appendMessage', sender: 'assistant', text: 'Cancelled.', success: false },
    ])
    expect(h.posted.at(-1)).toEqual({ type: 'stopStreaming' })
  })

  it('refuses a second request while one is running, without disturbing the first', async () => {
    const h = setUp((_prompt, context) => new Promise(resolve => {
      context.signal?.addEventListener('abort', () => resolve({ success: true, response: 'partial' }), { once: true })
    }))

    const first = h.send(sendPrompt('first'))
    await vi.waitFor(() => expect(h.agent.run).toHaveBeenCalledTimes(1))
    await h.send(sendPrompt('second'))

    expect(h.agent.run).toHaveBeenCalledTimes(1)
    expect(h.posted).toContainEqual(expect.objectContaining({ type: 'appendMessage', sender: 'assistant', success: false, text: expect.stringContaining('still running') }))
    expect((h.agent.run.mock.calls[0][1] as { signal: AbortSignal }).signal.aborted).toBe(false)

    await h.send({ type: 'cancelRequest' })
    await first
  })

  it('runs the next request once the previous one has finished', async () => {
    const h = setUp(async () => ({ success: true, response: 'an answer' }))
    await h.send(sendPrompt('one'))
    await h.send(sendPrompt('two'))
    expect(h.agent.run).toHaveBeenCalledTimes(2)
    expect(h.posted.filter(m => m.type === 'appendMessage' && m.sender === 'assistant')).toEqual([
      { type: 'appendMessage', sender: 'assistant', text: 'an answer', success: true },
      { type: 'appendMessage', sender: 'assistant', text: 'an answer', success: true },
    ])
  })

  it('leaves the streaming state, and accepts the next request, even when the agent throws', async () => {
    const h = setUp(async (prompt) => {
      if (prompt === 'broken') {throw new Error('provider exploded')}
      return { success: true, response: 'recovered' }
    })

    await expect(h.send(sendPrompt('broken'))).rejects.toThrow('provider exploded')
    expect(h.posted.at(-1)).toEqual({ type: 'stopStreaming' })

    await h.send(sendPrompt('next'))
    expect(h.agent.run).toHaveBeenCalledTimes(2)
    expect(h.posted).toContainEqual({ type: 'appendMessage', sender: 'assistant', text: 'recovered', success: true })
  })

  it('the webview has a stop button, shown while streaming, that sends the cancellation', async () => {
    const h = setUp(async () => ({ success: true, response: 'ok' }))
    expect(h.view.webview.html).toContain('id="stopBtn"')
    expect(h.view.webview.html).toContain("type:'cancelRequest'")
    expect(h.view.webview.html).toContain("msg.type==='startStreaming'")
    expect(h.view.webview.html).toContain("msg.type==='stopStreaming'")
  })

  it('the webview script parses, so a typo in the stop wiring cannot break the whole chat', async () => {
    const h = setUp(async () => ({ success: true, response: 'ok' }))
    const scripts = [...h.view.webview.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])
    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) {
      expect(() => new Function(script)).not.toThrow()
    }
  })
})
