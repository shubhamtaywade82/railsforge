import { describe, it, expect } from 'vitest'
import { signalFromCancellation } from '../src/util/CancellationSignal'

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
