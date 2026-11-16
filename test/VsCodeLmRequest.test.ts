// The request to the editor's language model. The model here is a fake, but its cancellation token behaves as the editor's
// does: it reports cancellation, and it notifies listeners when it is cancelled. Covered: the operation's signal, the
// timeout, an operation cancelled before it started, a completed answer, a stream that ends quietly after cancellation,
// and the errors for a missing model.
import { describe, it, expect, vi } from 'vitest'

vi.mock('vscode', () => {
  class CancellationTokenSource {
    private cancelled = false
    private listeners: Array<() => void> = []
    readonly token = {
      get isCancellationRequested(): boolean { return this.owner.cancelled },
      owner: undefined as unknown as CancellationTokenSource,
      onCancellationRequested: (listener: () => void) => {
        this.token.owner.listeners.push(listener)
        return { dispose() {} }
      },
    }
    constructor() { this.token.owner = this }
    cancel(): void {
      if (this.cancelled) {return}
      this.cancelled = true
      for (const listener of this.listeners) {listener()}
    }
    dispose(): void {}
  }
  return {
    CancellationTokenSource,
    LanguageModelChatMessage: { User: (content: string) => ({ role: 'user', content }) },
  }
})

import { requestViaVsCodeLm } from '../src/agent/VsCodeLmRequest'

interface Token { isCancellationRequested: boolean; onCancellationRequested(listener: () => void): unknown }

/** A model whose answer streams `chunks`. With `waitForCancel`, the stream then waits for the token, and ends quietly or throws. */
function fakeModel(options: { chunks: string[]; waitForCancel?: boolean; endQuietly?: boolean; failAtStart?: boolean }) {
  const seen: { token?: Token; messages?: Array<{ content: string }> } = {}
  const model = {
    sendRequest: vi.fn(async (messages: Array<{ content: string }>, _options: unknown, token: Token) => {
      if (options.failAtStart) {throw new Error('the model refused')}
      seen.token = token
      seen.messages = messages
      return {
        text: (async function* () {
          for (const chunk of options.chunks) {yield chunk}
          if (options.waitForCancel) {
            await new Promise<void>(resolve => {
              if (token.isCancellationRequested) {resolve()} else {token.onCancellationRequested(() => resolve())}
            })
            if (!options.endQuietly) {throw new Error('the editor cancelled the request')}
          }
        })(),
      }
    }),
  }
  return { model, seen }
}

const select = (model: unknown) => ({ selectModel: async () => model as never })

describe('a cancelled operation cancels the model request', () => {
  it('the signal cancels the editor token, the model stops, and the request throws rather than returning the partial answer', async () => {
    const { model, seen } = fakeModel({ chunks: ['partial '], waitForCancel: true, endQuietly: true })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 20)

    await expect(requestViaVsCodeLm(select(model), 'system', 'prompt', '', 60_000, controller.signal)).rejects.toThrow('cancelled')
    expect(seen.token?.isCancellationRequested).toBe(true)
  })

  it('a timeout cancels the editor token the same way', async () => {
    const { model, seen } = fakeModel({ chunks: [], waitForCancel: true, endQuietly: true })
    await expect(requestViaVsCodeLm(select(model), 'system', 'prompt', '', 20)).rejects.toThrow('cancelled')
    expect(seen.token?.isCancellationRequested).toBe(true)
  })

  it('an operation cancelled before the request starts sends a model request whose token is already cancelled', async () => {
    const { model, seen } = fakeModel({ chunks: ['never used'], waitForCancel: true, endQuietly: true })
    const controller = new AbortController()
    controller.abort()
    await expect(requestViaVsCodeLm(select(model), 'system', 'prompt', '', 60_000, controller.signal)).rejects.toThrow('cancelled')
    expect(seen.token?.isCancellationRequested).toBe(true)
  })

  it('a completed answer is returned whole, and a cancellation after it has ended does not reach the token', async () => {
    const { model, seen } = fakeModel({ chunks: ['hello', ' world'] })
    const controller = new AbortController()
    const answer = await requestViaVsCodeLm(select(model), 'system', 'prompt', '', 60_000, controller.signal)
    expect(answer).toBe('hello world')

    controller.abort()
    expect(seen.token?.isCancellationRequested).toBe(false)
  })

  it('the system prompt is folded into the first user message, because the model API has no system role', async () => {
    const { model, seen } = fakeModel({ chunks: ['ok'] })
    await requestViaVsCodeLm(select(model), 'You are RailsForge.', 'Explain the order.', '', 60_000)
    expect(seen.messages?.[0].content).toBe('You are RailsForge.\n\n---\n\nExplain the order.')
  })

  it('a model that refuses the request is reported as that error', async () => {
    const { model } = fakeModel({ chunks: [], failAtStart: true })
    await expect(requestViaVsCodeLm(select(model), 'system', 'prompt', '', 60_000)).rejects.toThrow('the model refused')
  })
})

describe('no model to ask', () => {
  it('names the family the user configured, when no model matches it', async () => {
    await expect(requestViaVsCodeLm({ selectModel: async () => undefined }, 's', 'p', 'gpt-x', 60_000)).rejects.toThrow('matches family "gpt-x"')
  })

  it('says none is available, when no family is configured', async () => {
    await expect(requestViaVsCodeLm({ selectModel: async () => undefined }, 's', 'p', '', 60_000)).rejects.toThrow('No VS Code language model is available')
  })
})
