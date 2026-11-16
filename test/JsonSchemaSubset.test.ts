import { describe, it, expect } from 'vitest'
import { compileObjectSchema, validateValue } from '../src/mcp/external/JsonSchemaSubset'

const compile = (schema: unknown) => {
  const result = compileObjectSchema(schema)
  if (!result.ok) {throw new Error(`expected a supported schema: ${result.problems.join('; ')}`)}
  return result.root
}
const validate = (schema: unknown, value: unknown) => validateValue(compile(schema), value)

const orders = {
  type: 'object',
  properties: {
    model: { type: 'string', minLength: 1, maxLength: 40, pattern: '^[A-Z][A-Za-z]*$' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    status: { enum: ['open', 'closed'] },
    tags: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 5 },
    filter: { type: 'object', properties: { active: { type: 'boolean' } }, required: ['active'], additionalProperties: false },
    nullable: { type: ['string', 'null'] },
  },
  required: ['model'],
}

describe('compileObjectSchema: what is accepted', () => {
  it('accepts a typical MCP argument schema with the supported keywords', () => {
    expect(compileObjectSchema(orders).ok).toBe(true)
  })

  it('accepts annotation keywords, which do not change validity', () => {
    const result = compileObjectSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Lookup',
      description: 'Looks things up.',
      type: 'object',
      properties: { model: { type: 'string', description: 'A model', default: 'Order', examples: ['Order'] } },
    })
    expect(result.ok).toBe(true)
  })

  it('accepts an object with no properties (a tool that takes no arguments)', () => {
    expect(compileObjectSchema({ type: 'object' }).ok).toBe(true)
  })
})

describe('compileObjectSchema: what is rejected, rather than silently weakened', () => {
  it.each([
    ['$ref', { type: 'object', properties: { a: { $ref: '#/$defs/a' } } }],
    ['oneOf', { type: 'object', properties: { a: { oneOf: [{ type: 'string' }, { type: 'number' }] } } }],
    ['anyOf', { type: 'object', properties: { a: { anyOf: [{ type: 'string' }] } } }],
    ['allOf', { type: 'object', allOf: [{ required: ['a'] }] }],
    ['not', { type: 'object', properties: { a: { not: { type: 'string' } } } }],
    ['if', { type: 'object', if: { properties: { a: { const: 1 } } }, then: { required: ['b'] } }],
    ['patternProperties', { type: 'object', patternProperties: { '^x': { type: 'string' } } }],
    ['format', { type: 'object', properties: { email: { type: 'string', format: 'email' } } }],
    ['prefixItems', { type: 'object', properties: { pair: { type: 'array', prefixItems: [{ type: 'string' }] } } }],
    ['futureKeyword', { type: 'object', properties: { a: { type: 'string', futureKeyword: true } } }],
  ])('rejects the %s keyword', (keyword, schema) => {
    const result = compileObjectSchema(schema)
    expect(result.ok).toBe(false)
    if (!result.ok) {expect(result.problems.join(' ')).toContain(`unsupported keyword "${keyword}"`)}
  })

  it('rejects a root that is not an object schema', () => {
    expect(compileObjectSchema({ type: 'string' }).ok).toBe(false)
    expect(compileObjectSchema({ properties: { a: { type: 'string' } } }).ok).toBe(false)
  })

  it('rejects a boolean schema, which would mean accept-anything or accept-nothing', () => {
    expect(compileObjectSchema({ type: 'object', properties: { a: true } }).ok).toBe(false)
  })

  it('rejects additionalProperties given as a schema', () => {
    const result = compileObjectSchema({ type: 'object', additionalProperties: { type: 'string' } })
    expect(result.ok).toBe(false)
  })

  it('rejects a pattern that is not a valid regular expression', () => {
    const result = compileObjectSchema({ type: 'object', properties: { a: { type: 'string', pattern: '([' } } })
    expect(result.ok).toBe(false)
    if (!result.ok) {expect(result.problems.join(' ')).toContain('not a valid regular expression')}
  })

  it('rejects an unknown type name and an empty enum', () => {
    expect(compileObjectSchema({ type: 'object', properties: { a: { type: 'date' } } }).ok).toBe(false)
    expect(compileObjectSchema({ type: 'object', properties: { a: { enum: [] } } }).ok).toBe(false)
  })

  it('reports the path of the offending schema node', () => {
    const result = compileObjectSchema({ type: 'object', properties: { filter: { type: 'object', properties: { x: { oneOf: [] } } } } })
    expect(result.ok).toBe(false)
    if (!result.ok) {expect(result.problems[0]).toContain('filter.x uses the unsupported keyword "oneOf"')}
  })
})

describe('validateValue: what is enforced', () => {
  it('accepts valid arguments', () => {
    expect(validate(orders, { model: 'Order', limit: 5, status: 'open', tags: ['a'], filter: { active: true }, nullable: null })).toEqual({ ok: true })
  })

  it('reports a missing required argument by name', () => {
    expect(validate(orders, { limit: 5 })).toEqual({ ok: false, errors: ['model: is required'] })
  })

  it('reports a wrong type, and a number that is not an integer', () => {
    expect(validate(orders, { model: 'Order', limit: 2.5 })).toEqual({ ok: false, errors: ['limit: expected integer'] })
    expect(validate(orders, { model: 7 })).toEqual({ ok: false, errors: ['model: expected string'] })
  })

  it('enforces enum, minimum, maximum, lengths and pattern', () => {
    const result = validate(orders, { model: 'order', limit: 0, status: 'pending' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual(expect.arrayContaining([
        'model: does not match the required pattern',
        'limit: must be at least 1',
        'status: must be one of "open", "closed"',
      ]))
    }
    expect(validate(orders, { model: 'A'.repeat(41) }).ok).toBe(false)
  })

  it('checks each item of an array, and the array bounds', () => {
    expect(validate(orders, { model: 'Order', tags: ['a', 3] })).toEqual({ ok: false, errors: ['tags[1]: expected string'] })
    expect(validate(orders, { model: 'Order', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }).ok).toBe(false)
  })

  it('rejects an unknown argument when additionalProperties is false, and checks a nested object', () => {
    expect(validate(orders, { model: 'Order', filter: { active: true, extra: 1 } })).toEqual({
      ok: false,
      errors: ['filter.extra: is not an allowed argument'],
    })
    expect(validate(orders, { model: 'Order', filter: {} })).toEqual({ ok: false, errors: ['filter.active: is required'] })
  })

  it('allows an unknown argument when additionalProperties is not set (JSON Schema default)', () => {
    expect(validate(orders, { model: 'Order', unexpected: true })).toEqual({ ok: true })
  })

  it('rejects arguments that are not an object at all', () => {
    expect(validate(orders, [] as never).ok).toBe(false)
    expect(validate(orders, 'Order' as never).ok).toBe(false)
    expect(validate(orders, null as never).ok).toBe(false)
  })

  it('treats a missing optional argument as absent, not as a type error', () => {
    expect(validate(orders, { model: 'Order' })).toEqual({ ok: true })
  })

  it('compares const and enum values structurally', () => {
    const schema = { type: 'object', properties: { pick: { enum: [{ a: 1 }, [1, 2]] }, fixed: { const: 'yes' } } }
    expect(validate(schema, { pick: { a: 1 }, fixed: 'yes' })).toEqual({ ok: true })
    expect(validate(schema, { pick: [1, 2, 3], fixed: 'no' })).toEqual({ ok: false, errors: ['pick: must be one of {"a":1}, [1,2]', 'fixed: must be "yes"'] })
  })
})
