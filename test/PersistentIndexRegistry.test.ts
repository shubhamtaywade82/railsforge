import { describe, it, expect, vi } from 'vitest'
import { PersistentIndexRegistry, IndexOutcome } from '../src/indexer/PersistentIndexRegistry'

interface M { root: string; dispose: () => void }
const mk = (root: string): M => ({ root, dispose: vi.fn() })

describe('PersistentIndexRegistry', () => {
  it('keeps a separate manager per root', async () => {
    const reg = new PersistentIndexRegistry<M>(async root => ({ status: 'ready', manager: mk(root) }))
    await reg.ensure('/ws/a')
    await reg.ensure('/ws/b')
    expect(reg.get('/ws/a')?.root).toBe('/ws/a')
    expect(reg.get('/ws/b')?.root).toBe('/ws/b')
    expect(reg.get('/ws/c')).toBeNull()
  })

  it('shares one activation between concurrent ensure() calls', async () => {
    const activator = vi.fn(async (root: string): Promise<IndexOutcome<M>> => ({ status: 'ready', manager: mk(root) }))
    const reg = new PersistentIndexRegistry<M>(activator)
    await Promise.all([reg.ensure('/ws/a'), reg.ensure('/ws/a'), reg.ensure('/ws/a')])
    expect(activator).toHaveBeenCalledTimes(1)
  })

  it('remembers an unsupported runtime and does not retry other roots', async () => {
    const activator = vi.fn(async (): Promise<IndexOutcome<M>> => ({ status: 'unsupported', reason: 'N-API 9' }))
    const reg = new PersistentIndexRegistry<M>(activator)
    await reg.ensure('/ws/a')
    const s = await reg.ensure('/ws/b')
    expect(s).toEqual({ status: 'unsupported', reason: 'N-API 9' })
    expect(activator).toHaveBeenCalledTimes(1)
    expect(reg.state('/ws/b').status).toBe('unsupported')
  })

  it('retries after a failure', async () => {
    let n = 0
    const reg = new PersistentIndexRegistry<M>(async root =>
      ++n === 1 ? { status: 'failed', reason: 'boom' } : { status: 'ready', manager: mk(root) })
    expect((await reg.ensure('/ws/a')).status).toBe('failed')
    expect((await reg.ensure('/ws/a')).status).toBe('ready')
  })

  it('treats a thrown activator as failed', async () => {
    const reg = new PersistentIndexRegistry<M>(async () => { throw new Error('worker crashed') })
    expect(await reg.ensure('/ws/a')).toEqual({ status: 'failed', reason: 'worker crashed' })
  })

  it('release() disposes a ready manager', async () => {
    const reg = new PersistentIndexRegistry<M>(async root => ({ status: 'ready', manager: mk(root) }))
    await reg.ensure('/ws/a')
    const m = reg.get('/ws/a')!
    reg.release('/ws/a')
    expect(m.dispose).toHaveBeenCalledTimes(1)
    expect(reg.get('/ws/a')).toBeNull()
  })

  it('disposes a manager whose folder was removed while it was still starting', async () => {
    let resolve!: (o: IndexOutcome<M>) => void
    const reg = new PersistentIndexRegistry<M>(() => new Promise(r => { resolve = r }))
    const p = reg.ensure('/ws/a')
    reg.release('/ws/a')
    const m = mk('/ws/a')
    resolve({ status: 'ready', manager: m })
    await p
    expect(m.dispose).toHaveBeenCalledTimes(1)
    expect(reg.get('/ws/a')).toBeNull()
  })

  it('dispose() disposes every manager and ignores later ensure()', async () => {
    const reg = new PersistentIndexRegistry<M>(async root => ({ status: 'ready', manager: mk(root) }))
    await reg.ensure('/ws/a')
    await reg.ensure('/ws/b')
    const [a, b] = [reg.get('/ws/a')!, reg.get('/ws/b')!]
    reg.dispose()
    expect(a.dispose).toHaveBeenCalled()
    expect(b.dispose).toHaveBeenCalled()
    expect((await reg.ensure('/ws/c')).status).toBe('idle')
  })

  it('notifies on state changes', async () => {
    const seen: string[] = []
    const reg = new PersistentIndexRegistry<M>(async root => ({ status: 'ready', manager: mk(root) }), (_r, s) => seen.push(s.status))
    await reg.ensure('/ws/a')
    expect(seen).toEqual(['starting', 'ready'])
  })
})
