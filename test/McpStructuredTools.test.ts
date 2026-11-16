// The structured results of the first wave of native tools, run in-process against the Rails fixture. Each successful result
// is checked against the tool's declared output schema, and its text is checked to be unchanged from earlier versions. The
// same calls, through the invocation and the MCP mapping, are checked as the server makes them.
import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { z } from 'zod'
import { RAILSFORGE_TOOLS, ToolDefinition } from '../src/mcp/tools/definitions'
import { ToolContext } from '../src/mcp/tools/ToolContext'
import { invokeTool, ToolOutput } from '../src/mcp/policy/ToolInvocation'
import { toCallToolResult } from '../src/mcp/McpResults'

const PROJECT = path.join(__dirname, 'fixtures', 'rails-app')
const ctx = new ToolContext(PROJECT, path.join(__dirname, '..', 'dist', 'skills'))

const tool = (name: string): ToolDefinition => {
  const found = RAILSFORGE_TOOLS.find(t => t.name === name)
  if (!found) {throw new Error(`no tool named ${name}`)}
  return found
}

/** The declared structure of a tool. A tool with no declaration fails the test that asks for it. */
const declared = (name: string) => {
  const shape = tool(name).outputSchema
  if (!shape) {throw new Error(`${name} declares no output schema`)}
  return z.object(shape)
}

/** The result of a successful call, which must carry both text and a structured value. */
function structuredOf(output: ToolOutput): { text: string; data: Record<string, unknown> } {
  if (typeof output === 'string' || output.data === undefined) {throw new Error('expected a structured result')}
  return output
}

describe('list_routes', () => {
  it('returns the matching routes as a structured list, and the text is the bare list as it always was', async () => {
    const out = structuredOf(await tool('list_routes').handler(ctx, { filter: 'orders' }))
    const routes = out.data.routes as Array<{ controller: string; action: string }>
    expect(routes.map(route => route.action)).toEqual(['index', 'show'])
    expect(out.text).toBe(JSON.stringify(routes, null, 2))
    expect(declared('list_routes').safeParse(out.data).success).toBe(true)
  })

  it('an empty result is a valid, empty structured list', async () => {
    const out = structuredOf(await tool('list_routes').handler(ctx, { filter: 'no-such-route' }))
    expect(out.data).toEqual({ routes: [] })
    expect(out.text).toBe('[]')
    expect(declared('list_routes').safeParse(out.data).success).toBe(true)
  })
})

describe('list_patterns', () => {
  it('returns the project\'s services with their public methods, as structured data', async () => {
    const out = structuredOf(await tool('list_patterns').handler(ctx, { type: 'service' }))
    const patterns = out.data.patterns as Array<{ name: string; type: string; publicMethods: string[] }>
    expect(patterns).toEqual([expect.objectContaining({ name: 'CreateOrderService', type: 'service' })])
    // The indexer also lists `initialize`, which Ruby makes private; that is an existing indexer behaviour, not asserted here.
    expect(patterns[0].publicMethods).toContain('call')
    expect(declared('list_patterns').safeParse(out.data).success).toBe(true)
  })

  it('an empty result is a valid, empty structured list', async () => {
    const out = structuredOf(await tool('list_patterns').handler(ctx, { type: 'query' }))
    expect(out.data).toEqual({ patterns: [] })
    expect(declared('list_patterns').safeParse(out.data).success).toBe(true)
  })
})

describe('list_rake_tasks', () => {
  it('with no tasks, returns the explanation as text and an empty structured list', async () => {
    const out = structuredOf(await tool('list_rake_tasks').handler(ctx, {}))
    expect(out.data).toEqual({ tasks: [] })
    expect(out.text).toContain('No Rake tasks found')
    expect(declared('list_rake_tasks').safeParse(out.data).success).toBe(true)
  })
})

describe('an unavailable index is a coded error, not a text answer', () => {
  it.each(['get_dependencies', 'find_duplicate_methods'])('%s throws INDEX_UNAVAILABLE when the workspace has no index', async name => {
    const input = name === 'get_dependencies' ? { name: 'Order' } : {}
    await expect(Promise.resolve(tool(name).handler(ctx, input))).rejects.toMatchObject({ code: 'INDEX_UNAVAILABLE' })
  })
})

describe('the same calls, as the server makes them: invocation, then the MCP mapping', () => {
  const standalone = (name: string, args: Record<string, unknown>, trusted = true) =>
    invokeTool(tool(name), ctx, args, { source: 'standalone', isTrusted: () => trusted })

  it('a successful list call is a structured MCP result with its text, and no error', async () => {
    const result = toCallToolResult(await standalone('list_routes', { filter: 'orders' }), tool('list_routes').outputSchema)
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toMatchObject({ routes: expect.arrayContaining([expect.objectContaining({ action: 'show' })]) })
    expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('"action": "show"') }])
  })

  it('an unavailable index is an error with its code in _meta, and no structured content', async () => {
    const result = toCallToolResult(await standalone('get_dependencies', { name: 'Order' }), tool('get_dependencies').outputSchema)
    expect(result).toMatchObject({ isError: true, _meta: { railsforge: { code: 'INDEX_UNAVAILABLE' } } })
    expect(result.structuredContent).toBeUndefined()
  })

  it('a call that runs project code, in an untrusted workspace, is refused on the standalone path with its code', async () => {
    const result = toCallToolResult(await standalone('list_rake_tasks', {}, false), tool('list_rake_tasks').outputSchema)
    expect(result).toMatchObject({ isError: true, _meta: { railsforge: { code: 'EXECUTION_DISABLED' } } })
  })
})
