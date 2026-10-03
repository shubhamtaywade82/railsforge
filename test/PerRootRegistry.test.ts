import { describe, it, expect, vi } from 'vitest'
import { PerRootRegistry } from '../src/workspace/PerRootRegistry'

describe('PerRootRegistry', () => {
  it('creates one value per root, lazily and once', () => {
    const factory = vi.fn((root: string) => ({ root }))
    const reg = new PerRootRegistry(factory)
    expect(reg.get('/a')).toBe(reg.get('/a'))
    expect(reg.get('/b')).not.toBe(reg.get('/a'))
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('drop() and retainOnly() remove roots and notify', () => {
    const onDrop = vi.fn()
    const reg = new PerRootRegistry((root: string) => ({ root }), onDrop)
    reg.get('/a'); reg.get('/b'); reg.get('/c')
    reg.retainOnly(['/b'])
    expect(reg.roots()).toEqual(['/b'])
    expect(onDrop).toHaveBeenCalledTimes(2)
    reg.drop('/missing')
    expect(onDrop).toHaveBeenCalledTimes(2)
  })
})
