import { afterEach, describe, expect, it, vi } from 'vitest'
import { UntrustedWorkspaceError, assertTrusted, isWorkspaceTrusted, setBlockedListener, setTrustProvider } from '../src/workspace/Trust'

const restore = setTrustProvider(() => true)
afterEach(() => {
  setTrustProvider(() => true)
  setBlockedListener(undefined)
})

describe('workspace trust gate', () => {
  it('defaults to trusted (standalone MCP server / tests never launch project processes)', () => {
    expect(restore()).toBeTypeOf('boolean') // the initial provider
    expect(isWorkspaceTrusted()).toBe(true)
    expect(() => assertTrusted('anything')).not.toThrow()
  })

  it('refuses with a typed, explanatory error and reports the blocked action', () => {
    const blocked = vi.fn()
    setBlockedListener(blocked)
    setTrustProvider(() => false)
    expect(isWorkspaceTrusted()).toBe(false)
    let thrown: unknown
    try { assertTrusted('rubocop') } catch (err) { thrown = err }
    expect(thrown).toBeInstanceOf(UntrustedWorkspaceError)
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
