import { describe, it, expect, vi } from 'vitest'
import { OnceByKey } from '../src/util/OnceByKey'

describe('OnceByKey', () => {
  it('starts the task once per key and shares its promise with every caller', async () => {
    const once = new OnceByKey<string, number>()
    const task = vi.fn(async () => 42)

    const first = once.run('root-a', task)
    const second = once.run('root-a', task)

    expect(second).toBe(first)
    expect(await first).toBe(42)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('keeps keys independent', async () => {
    const once = new OnceByKey<string, string>()
    const task = vi.fn(async () => 'ok')

    await once.run('root-a', task)
    await once.run('root-b', task)

    expect(task).toHaveBeenCalledTimes(2)
    expect(once.has('root-a')).toBe(true)
    expect(once.has('root-c')).toBe(false)
  })

  it('does not start the task again while it is still pending', async () => {
    const once = new OnceByKey<string, void>()
    let release: () => void = () => {}
    const task = vi.fn(() => new Promise<void>(resolve => { release = resolve }))

    const a = once.run('k', task)
    const b = once.run('k', task)
    expect(task).toHaveBeenCalledTimes(1)

    release()
    await Promise.all([a, b])
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('memoizes a failed task instead of retrying it on every call (no request storm from hovers)', async () => {
    const once = new OnceByKey<string, number>()
    const task = vi.fn(async () => { throw new Error('offline') })

    await expect(once.run('k', task)).rejects.toThrow('offline')
    await expect(once.run('k', task)).rejects.toThrow('offline')
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('memoizes a synchronous throw as a rejection', async () => {
    const once = new OnceByKey<string, number>()
    const task = vi.fn((): Promise<number> => { throw new Error('sync boom') })

    await expect(once.run('k', task)).rejects.toThrow('sync boom')
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('clear(key) lets an explicit retry start the task again', async () => {
    const once = new OnceByKey<string, number>()
    const task = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(7)

    await expect(once.run('k', task)).rejects.toThrow('network down')
    once.clear('k')
    expect(await once.run('k', task)).toBe(7)
    expect(task).toHaveBeenCalledTimes(2)
  })
})
