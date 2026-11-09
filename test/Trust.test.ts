import { afterEach, describe, expect, it, vi } from 'vitest'
import { UntrustedWorkspaceError, assertTrusted, isWorkspaceTrusted, setBlockedListener, setTrustProvider } from '../src/workspace/Trust'

setTrustProvider(() => true)
afterEach(() => {
  setTrustProvider(() => true)
  setBlockedListener(undefined)
})

describe('workspace trust gate', () => {
  it('fails closed until a provider is installed, so nothing runs by default', async () => {
    // A fresh module instance has never had a provider installed.
    vi.resetModules()
    const fresh = await import('../src/workspace/Trust')
    expect(fresh.isWorkspaceTrusted()).toBe(false)
    expect(() => fresh.assertTrusted('anything')).toThrow(fresh.UntrustedWorkspaceError)
  })

  it('refuses with a typed, explanatory error and reports the blocked action', () => {
    const blocked = vi.fn()
    setBlockedListener(blocked)
    setTrustProvider(() => false)
    expect(isWorkspaceTrusted()).toBe(false)
    let thrown: unknown
    try { assertTrusted('rubocop') } catch (err) { thrown = err }
    expect(thrown).toBeInstanceOf(UntrustedWorkspaceError)
    expect((thrown as Error).name).toBe('UntrustedWorkspaceError')
    expect((thrown as UntrustedWorkspaceError).code).toBe('RAILSFORGE_UNTRUSTED_WORKSPACE')
    expect((thrown as Error).message).toMatch(/"rubocop" runs project code.*Restricted Mode/)
    expect(blocked).toHaveBeenCalledWith('rubocop')
  })

  it('fails closed when trust cannot be determined', () => {
    setTrustProvider(() => { throw new Error('host exploded') })
    expect(isWorkspaceTrusted()).toBe(false)
    expect(() => assertTrusted('x')).toThrow(UntrustedWorkspaceError)
  })

  it('a failing blocked-listener can never turn a refusal into an execution', () => {
    setTrustProvider(() => false)
    setBlockedListener(() => { throw new Error('logger broke') })
    expect(() => assertTrusted('x')).toThrow(UntrustedWorkspaceError)
  })

  it('tracks trust changes live (workspace becomes trusted without restarting)', () => {
    let trusted = false
    setTrustProvider(() => trusted)
    expect(() => assertTrusted('x')).toThrow()
    trusted = true
    expect(() => assertTrusted('x')).not.toThrow()
  })
})
