// The response contract for one call: text always; structuredContent only when the tool declares one, and only when it
// matches the declaration; a failure carries isError and a stable code in _meta, and no structuredContent.
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { toCallToolResult } from '../src/mcp/McpResults'

const LIST = { routes: z.array(z.object({ verb: z.string(), uriPattern: z.string() })) }

describe('toCallToolResult: a successful call', () => {
  it('returns the text, and the structured value when the tool declares one', () => {
    const result = toCallToolResult({ ok: true, text: '[...]', data: { routes: [{ verb: 'GET', uriPattern: '/orders' }] } }, LIST)
    expect(result).toEqual({
      content: [{ type: 'text', text: '[...]' }],
      structuredContent: { routes: [{ verb: 'GET', uriPattern: '/orders' }] },
    })
    expect(result.isError).toBeUndefined()
  })

  it('an empty list is a valid result, and is returned as an empty structured list', () => {
    const result = toCallToolResult({ ok: true, text: 'No routes.', data: { routes: [] } }, LIST)
    expect(result.structuredContent).toEqual({ routes: [] })
    expect(result.isError).toBeUndefined()
  })

  it('a tool with no declared output returns text only, even if a structured value came with the text', () => {
    const result = toCallToolResult({ ok: true, text: 'plain', data: { ignored: true } })
    expect(result).toEqual({ content: [{ type: 'text', text: 'plain' }] })
  })

  it('nested objects and arrays inside the structured value are returned as they are', () => {
    const shape = { skills: z.array(z.object({ id: z.string(), tags: z.array(z.string()), meta: z.object({ count: z.number() }) })) }
    const data = { skills: [{ id: 'a', tags: ['x', 'y'], meta: { count: 2 } }] }
    expect(toCallToolResult({ ok: true, text: 't', data }, shape).structuredContent).toEqual(data)
  })
})

describe('toCallToolResult: a structured value that does not match its declaration', () => {
  it('is a coded tool error, not a success', () => {
    const result = toCallToolResult({ ok: true, text: 't', data: { routes: [{ verb: 'GET' }] } }, LIST)
    expect(result.isError).toBe(true)
    expect(result._meta).toEqual({ railsforge: { code: 'OUTPUT_CONTRACT' } })
    expect(result.structuredContent).toBeUndefined()
  })

  it('is a coded tool error when the tool declares a structure and produced none', () => {
    const result = toCallToolResult({ ok: true, text: 't' }, LIST)
    expect(result.isError).toBe(true)
    expect(result._meta).toEqual({ railsforge: { code: 'OUTPUT_CONTRACT' } })
  })
})

describe('toCallToolResult: a failed call', () => {
  it('is an error with the message as text, and the stable code in _meta, and no structured content', () => {
    const result = toCallToolResult({ ok: false, code: 'APPROVAL_REQUIRED', message: 'RailsForge: list_rake_tasks was not run.' }, LIST)
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'RailsForge: list_rake_tasks was not run.' }],
      _meta: { railsforge: { code: 'APPROVAL_REQUIRED' } },
    })
  })

  it('keeps each failure code distinct, so a cancellation is not reported as a timeout', () => {
    const codes = ['CANCELLED', 'TIMEOUT', 'WORKSPACE_UNTRUSTED', 'INDEX_UNAVAILABLE', 'SKILLS_UNAVAILABLE'].map(code =>
      toCallToolResult({ ok: false, code, message: code }, LIST)._meta,
    )
    expect(codes).toEqual([
      { railsforge: { code: 'CANCELLED' } },
      { railsforge: { code: 'TIMEOUT' } },
      { railsforge: { code: 'WORKSPACE_UNTRUSTED' } },
      { railsforge: { code: 'INDEX_UNAVAILABLE' } },
      { railsforge: { code: 'SKILLS_UNAVAILABLE' } },
    ])
  })
})
