// A model call is cancellable: the loop passes its signal to the call, and a call that answers after the cancellation
// is not used. A call made without a signal still receives exactly two arguments, as before.
import { describe, it, expect, vi } from 'vitest'
import { runAgentLoop, CompleteFn } from '../src/agent/AgentLoop'

describe('cancelling a model call', () => {
  it('passes the signal to the call in progress, and does not use the answer that arrives after the cancellation', async () => {
    const controller = new AbortController()
    const seen: Array<AbortSignal | undefined> = []
    const complete: CompleteFn = (_system, _user, signal) => {
      seen.push(signal)
      return new Promise(resolve => {
        signal?.addEventListener('abort', () => setTimeout(() => resolve({ success: true, response: 'a late answer' }), 20), { once: true })
      })
    }
    setTimeout(() => controller.abort(), 10)

    const result = await runAgentLoop({ system: 's', prompt: 'p', complete, tools: [], signal: controller.signal })
    expect(seen[0]).toBe(controller.signal)
    expect(result).toMatchObject({ success: false, response: 'Cancelled.', stopped: 'cancelled' })
  })

  it('a call made without cancellation receives exactly the two arguments it always did', async () => {
    const complete = vi.fn(async () => ({ success: true, response: 'ok' }))
    const result = await runAgentLoop({ system: 's', prompt: 'p', complete, tools: [] })
    expect(result).toMatchObject({ success: true, response: 'ok' })
    expect(complete.mock.calls[0]).toHaveLength(2)
  })
})
