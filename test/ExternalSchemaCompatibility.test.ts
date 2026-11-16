// Input schemas that common MCP servers send, and what RailsForge does with each. A shape in the supported subset is
// offered and enforced. A shape outside it is not offered, and the reason names the keyword, so the user can see why a
// tool is missing. Nothing is loosened to make a tool appear. The fixtures are representative of the generators in use
// (pydantic, zod and hand-written schemas); they are not captured from any particular server.
import { describe, it, expect } from 'vitest'
import { exposeTools, checkArguments } from '../src/mcp/external/ExternalTools'

function offer(inputSchema: unknown) {
  return exposeTools('srv', [{ name: 't', inputSchema: inputSchema as never }], ['t'], { t: 'R2' })
}

const accepted: Array<[string, Record<string, unknown>]> = [
  ['a generated object schema with $schema, title and additionalProperties false', {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'QueryArguments',
    type: 'object',
    properties: { model: { type: 'string', description: 'Model name' } },
    required: ['model'],
    additionalProperties: false,
  }],
  ['optional fields with bounds, defaults and examples', {
    type: 'object',
    properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, examples: [5] } },
  }],
  ['a nullable field written as a type list', {
    type: 'object',
    properties: { note: { type: ['string', 'null'] } },
  }],
  ['an enumerated field', {
    type: 'object',
    properties: { level: { type: 'string', enum: ['info', 'warn', 'error'] } },
    required: ['level'],
  }],
  ['a nested object with its own required field', {
    type: 'object',
    properties: { filter: { type: 'object', properties: { column: { type: 'string' } }, required: ['column'] } },
  }],
  ['a list of strings with bounds', {
    type: 'object',
    properties: { tables: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 } },
  }],
  ['a tool that takes no arguments', { type: 'object', properties: {} }],
  ['an empty required list', { type: 'object', properties: { q: { type: 'string' } }, required: [] }],
]

const rejected: Array<[string, Record<string, unknown>, string]> = [
  ['an optional field pydantic writes as anyOf with null', {
    type: 'object',
    properties: { note: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
  }, 'anyOf'],
  ['a nested model referenced through $defs and $ref', {
    type: 'object',
    properties: { filter: { $ref: '#/$defs/Filter' } },
    $defs: { Filter: { type: 'object' } },
  }, '$ref'],
  ['a choice written as oneOf', {
    type: 'object',
    properties: { id: { oneOf: [{ type: 'string' }, { type: 'integer' }] } },
  }, 'oneOf'],
  ['a date checked by format', {
    type: 'object',
    properties: { since: { type: 'string', format: 'date-time' } },
  }, 'format'],
  ['an intersection written as allOf', {
    type: 'object',
    properties: { row: { allOf: [{ type: 'object' }, { required: ['id'] }] } },
  }, 'allOf'],
]

describe('common MCP input schemas: the supported shapes are offered and enforced', () => {
  it.each(accepted)('offers %s with no problem', (_label, schema) => {
    const { tools, problems } = offer(schema)
    expect(problems).toEqual([])
    expect(tools).toHaveLength(1)
  })

  it('enforces the nullable field: null is accepted, a number is not', () => {
    const schema = accepted.find(([label]) => label.includes('nullable'))![1]
    expect(checkArguments(schema, { note: null }).ok).toBe(true)
    expect(checkArguments(schema, { note: 5 }).ok).toBe(false)
  })

  it('enforces bounds and required fields inside a nested object', () => {
    const schema = accepted.find(([label]) => label.includes('nested'))![1]
    expect(checkArguments(schema, { filter: { column: 'id' } }).ok).toBe(true)
    expect(checkArguments(schema, { filter: {} })).toEqual({ ok: false, message: 'filter.column: is required' })
  })

  it('enforces the enumerated values', () => {
    const schema = accepted.find(([label]) => label.includes('enumerated'))![1]
    expect(checkArguments(schema, { level: 'warn' }).ok).toBe(true)
    expect(checkArguments(schema, { level: 'debug' }).ok).toBe(false)
  })
})

describe('common MCP input schemas: a shape outside the subset is not offered, and the reason names it', () => {
  it.each(rejected)('does not offer %s', (_label, schema, keyword) => {
    const { tools, problems } = offer(schema)
    expect(tools).toEqual([])
    expect(problems.join(' ')).toContain(keyword)
  })

  it('rejects a schema that gives additionalProperties as a schema, not as true or false', () => {
    const { tools, problems } = offer({ type: 'object', properties: {}, additionalProperties: { type: 'string' } })
    expect(tools).toEqual([])
    expect(problems.join(' ')).toContain('additionalProperties')
  })
})
