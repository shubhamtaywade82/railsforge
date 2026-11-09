import { describe, expect, it } from 'vitest'
import { EXECUTION_ENV, decideInvocation, readExecutionGrant } from '../src/mcp/policy/McpCapabilityPolicy'

describe('decideInvocation', () => {
  it('allows static reads (R0) and cached reads (R1) in every source, trusted or not', () => {
    for (const risk of ['R0', 'R1'] as const) {
      for (const source of ['standalone', 'host'] as const) {
        for (const trusted of [false, true]) {
          expect(decideInvocation(risk, { source, trusted })).toEqual({ allowed: true })
        }
      }
    }
  })

  it('refuses project code (R2) in standalone mode without the grant, and names the variable that grants it', () => {
    const decision = decideInvocation('R2', { source: 'standalone', trusted: false })
    expect(decision).toMatchObject({ allowed: false, code: 'EXECUTION_DISABLED' })
    expect(decision.allowed === false && decision.message).toContain(`${EXECUTION_ENV}=project-code`)
  })

  it('allows project code (R2) in standalone mode once the grant is present', () => {
    expect(decideInvocation('R2', { source: 'standalone', trusted: true })).toEqual({ allowed: true })
  })

  it('refuses project code (R2) in an untrusted host with WORKSPACE_UNTRUSTED, and allows it in a trusted host', () => {
    const refused = decideInvocation('R2', { source: 'host', trusted: false })
    expect(refused).toMatchObject({ allowed: false, code: 'WORKSPACE_UNTRUSTED' })
    expect(refused.allowed === false && refused.message).toContain('Restricted Mode')
    expect(decideInvocation('R2', { source: 'host', trusted: true })).toEqual({ allowed: true })
  })

  it('refuses R3 (no approval flow in this build) and R4 (never exposed) whatever the trust state', () => {
    for (const trusted of [false, true]) {
      for (const source of ['standalone', 'host'] as const) {
        expect(decideInvocation('R3', { source, trusted })).toMatchObject({ allowed: false, code: 'APPROVAL_REQUIRED' })
        expect(decideInvocation('R4', { source, trusted })).toMatchObject({ allowed: false, code: 'DISABLED_BY_POLICY' })
      }
    }
  })
})

describe('readExecutionGrant', () => {
  it('grants nothing when the variable is unset, empty or none', () => {
    expect(readExecutionGrant({})).toEqual({ grant: 'none' })
    expect(readExecutionGrant({ [EXECUTION_ENV]: '' })).toEqual({ grant: 'none' })
    expect(readExecutionGrant({ [EXECUTION_ENV]: '   ' })).toEqual({ grant: 'none' })
    expect(readExecutionGrant({ [EXECUTION_ENV]: 'none' })).toEqual({ grant: 'none' })
  })

  it('grants project code only for project-code, ignoring case and surrounding spaces', () => {
    expect(readExecutionGrant({ [EXECUTION_ENV]: 'project-code' })).toEqual({ grant: 'project-code' })
    expect(readExecutionGrant({ [EXECUTION_ENV]: '  Project-Code ' })).toEqual({ grant: 'project-code' })
  })

  it('treats any other value as no grant, and says so', () => {
    for (const value of ['true', 'all', 'project-code,boot-app', 'boot-app']) {
      const reading = readExecutionGrant({ [EXECUTION_ENV]: value })
      expect(reading.grant).toBe('none')
      expect(reading.warning).toContain('unrecognised')
    }
  })
})
