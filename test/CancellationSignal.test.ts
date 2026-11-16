import { describe, it, expect } from 'vitest'
import { signalFromCancellation, anySignal } from '../src/util/CancellationSignal'

describe('signalFromCancellation', () => {
  it('aborts the signal when the editor cancels the token', () => {
    let listener: (() => unknown) | undefined
    const token = { isCancellationRequested: false, onCancellationRequested: (l: () => unknown) => { listener = l } }
    const signal = signalFromCancellation(token)
    expect(signal.aborted).toBe(false)
    listener!()
    expect(signal.aborted).toBe(true)
  })

  it('gives an already aborted signal for a token that was cancelled before the request', () => {
    const signal = signalFromCancellation({ isCancellationRequested: true, onCancellationRequested: () => undefined })
    expect(signal.aborted).toBe(true)
  })
})

describe('anySignal', () => {
  it('aborts when any of its inputs aborts, and carries that reason', () => {
    const cancel = new AbortController()
    const timeout = new AbortController()
    const combined = anySignal(cancel.signal, timeout.signal)
    expect(combined.aborted).toBe(false)

    timeout.abort(new Error('timed out'))
    expect(combined.aborted).toBe(true)
    expect((combined.reason as Error).message).toBe('timed out')
  })

  it('aborts at once when the cancellation has already happened', () => {
    const cancel = new AbortController()
    cancel.abort()
    expect(anySignal(cancel.signal, undefined).aborted).toBe(true)
  })

  it('ignores missing inputs, and stays open while every present input is open', () => {
    const open = new AbortController()
    const combined = anySignal(undefined, open.signal, undefined)
    expect(combined.aborted).toBe(false)
    open.abort()
    expect(combined.aborted).toBe(true)
    expect(anySignal().aborted).toBe(false)
  })
})
