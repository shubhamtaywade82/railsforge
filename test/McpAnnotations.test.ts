// The MCP hints each native tool declares. They are derived from the tool's risk, so they cannot disagree with the policy.
import { describe, it, expect } from 'vitest'
import { RAILSFORGE_TOOLS, toolAnnotations } from '../src/mcp/tools/definitions'

describe('toolAnnotations', () => {
  it('marks a static or cached read as read-only and idempotent, and not destructive', () => {
    expect(toolAnnotations('R0')).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true })
    expect(toolAnnotations('R1')).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true })
  })

  it('marks project code as not read-only and destructive', () => {
    expect(toolAnnotations('R2')).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: false })
  })
})

describe('the native tools', () => {
  it('every native tool\'s hints follow its declared risk', () => {
    for (const tool of RAILSFORGE_TOOLS) {
      expect(toolAnnotations(tool.risk).readOnlyHint, tool.name).toBe(tool.risk === 'R0' || tool.risk === 'R1')
      expect(toolAnnotations(tool.risk).destructiveHint, tool.name).toBe(tool.risk === 'R2')
    }
  })
})
