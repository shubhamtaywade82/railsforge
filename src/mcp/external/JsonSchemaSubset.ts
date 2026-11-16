/**
 * JsonSchemaSubset - validates tool arguments against the JSON Schema an MCP server declares, for the part of the
 * language that decides whether a value is valid.
 *
 * Strict by construction: a schema is compiled once, when the tool is discovered. Any keyword outside the supported
 * set is an error and the tool is not offered. A schema that cannot be enforced is never silently weakened to "accept
 * anything", because the arguments reach a process that runs code.
 *
 * Supported validation keywords: type, properties, required, additionalProperties (true or false only), items (one
 * schema), enum, const, minimum, maximum, exclusiveMinimum, exclusiveMaximum, minLength, maxLength, pattern, minItems,
 * maxItems.
 *
 * Annotation keywords, which do not change validity, are accepted and ignored: title, description, default, examples,
 * $schema, $comment, deprecated, readOnly, writeOnly.
 *
 * One form of anyOf is supported, and only this one: the nullable value that Python's pydantic writes for an optional
 * field, exactly two branches, one a typed schema and the other {"type": "null"}, with no validation keyword beside
 * it. The value is valid when it is null, or when the typed branch accepts it, with that branch's own constraints.
 * Any other anyOf is rejected.
 *
 * Rejected: $ref, oneOf, allOf, not, if/then/else, patternProperties, propertyNames, dependentRequired,
 * dependentSchemas, unevaluatedProperties, prefixItems, contains, format, every anyOf other than the nullable form,
 * and any keyword not listed above. Boolean schemas are rejected too.
 *
 * vscode-free.
 */

export type JsonType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'

const JSON_TYPES: readonly JsonType[] = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']
const ANNOTATIONS: ReadonlySet<string> = new Set(['title', 'description', 'default', 'examples', '$schema', '$comment', 'deprecated', 'readOnly', 'writeOnly'])
const SUPPORTED: ReadonlySet<string> = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems',
])

/** One compiled schema node. Only what validation needs is kept. */
export interface SchemaNode {
  /** Set for the nullable anyOf form: null is valid, and any other value must satisfy the rest of this node. */
  nullable?: boolean
  types?: JsonType[]
  properties: Record<string, SchemaNode>
  required: string[]
  additionalProperties: boolean
  items?: SchemaNode
  enumValues?: unknown[]
  hasConst: boolean
  constValue?: unknown
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  minLength?: number
  maxLength?: number
  pattern?: RegExp
  minItems?: number
  maxItems?: number
}

export type CompileResult = { ok: true; root: SchemaNode } | { ok: false; problems: string[] }
export type ValidateResult = { ok: true } | { ok: false; errors: string[] }

/** Compiles a tool's input schema. The root must describe an object, which is what MCP requires of tool arguments. */
export function compileObjectSchema(schema: unknown): CompileResult {
  const problems: string[] = []
  const root = compileNode(schema, '', problems)
  if (!root) {return { ok: false, problems }}
  if (!root.types || root.types.length !== 1 || root.types[0] !== 'object') {
    problems.push('the root schema must declare "type": "object"')
  }
  if (root.nullable) {problems.push('the root schema cannot be nullable: tool arguments are always an object')}
  return problems.length > 0 ? { ok: false, problems } : { ok: true, root }
}

/** Validates a value against a compiled schema. Every error is reported, each with the path it applies to. */
export function validateValue(root: SchemaNode, value: unknown): ValidateResult {
  const errors: string[] = []
  check(root, value, '', errors)
  return errors.length > 0 ? { ok: false, errors } : { ok: true }
}

function compileNode(schema: unknown, path: string, problems: string[]): SchemaNode | undefined {
  const where = path || 'the root schema'
  if (!isPlainObject(schema)) {
    problems.push(`${where} must be an object schema`)
    return undefined
  }
  const before = problems.length
  for (const key of Object.keys(schema)) {
    if (ANNOTATIONS.has(key) || SUPPORTED.has(key) || key === 'anyOf') {continue}
    problems.push(`${where} uses the unsupported keyword "${key}"`)
  }
  if ('anyOf' in schema) {
    return compileNullable(schema, path, problems)
  }
  const node: SchemaNode = { properties: {}, required: [], additionalProperties: true, hasConst: false }

  if (schema.type !== undefined) {
    const declared = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (declared.length === 0 || !declared.every(t => typeof t === 'string' && (JSON_TYPES as readonly string[]).includes(t))) {
      problems.push(`${where} has an invalid "type"`)
    } else {
      node.types = [...new Set(declared as JsonType[])]
    }
  }

  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) {
      problems.push(`${where} has "properties" that is not an object`)
    } else {
      for (const [name, sub] of Object.entries(schema.properties)) {
        const compiled = compileNode(sub, joinPath(path, name), problems)
        if (compiled) {node.properties[name] = compiled}
      }
    }
  }

  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || !schema.required.every(name => typeof name === 'string')) {
      problems.push(`${where} has "required" that is not a list of names`)
    } else {
      node.required = [...new Set(schema.required as string[])]
    }
  }

  if (schema.additionalProperties !== undefined) {
    if (typeof schema.additionalProperties !== 'boolean') {
      problems.push(`${where} has "additionalProperties" that is not true or false (schemas are not supported)`)
    } else {
      node.additionalProperties = schema.additionalProperties
    }
  }

  if (schema.items !== undefined) {
    const compiled = compileNode(schema.items, `${path}[]`, problems)
    if (compiled) {node.items = compiled}
  }

  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      problems.push(`${where} has an "enum" that is not a non-empty list`)
    } else {
      node.enumValues = schema.enum
    }
  }

  if ('const' in schema) {
    node.hasConst = true
    node.constValue = schema.const
  }

  node.minimum = numberKeyword(schema, 'minimum', where, problems)
  node.maximum = numberKeyword(schema, 'maximum', where, problems)
  node.exclusiveMinimum = numberKeyword(schema, 'exclusiveMinimum', where, problems)
  node.exclusiveMaximum = numberKeyword(schema, 'exclusiveMaximum', where, problems)
  node.minLength = countKeyword(schema, 'minLength', where, problems)
  node.maxLength = countKeyword(schema, 'maxLength', where, problems)
  node.minItems = countKeyword(schema, 'minItems', where, problems)
  node.maxItems = countKeyword(schema, 'maxItems', where, problems)

  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') {
      problems.push(`${where} has a "pattern" that is not a string`)
    } else {
      try {
        node.pattern = new RegExp(schema.pattern, 'u')
      } catch {
        problems.push(`${where} has a "pattern" that is not a valid regular expression`)
      }
    }
  }

  return problems.length > before ? undefined : node
}

/**
 * The nullable form only: `anyOf: [<typed schema>, {"type": "null"}]`, with no validation keyword beside the anyOf.
 * Annotations (title, description, default) may sit beside it. Anything else is refused with the reason, and never
 * compiled into a looser schema.
 */
function compileNullable(schema: Record<string, unknown>, path: string, problems: string[]): SchemaNode | undefined {
  const where = path || 'the root schema'
  const before = problems.length
  const beside = Object.keys(schema).filter(key => key !== 'anyOf' && SUPPORTED.has(key))
  if (beside.length > 0) {
    problems.push(`${where} uses "anyOf" together with ${beside.map(key => `"${key}"`).join(', ')}; only the nullable form is supported (anyOf with a typed schema and {"type": "null"}), with no other validation keyword beside it`)
    return undefined
  }
  const branches = nullableBranches(schema.anyOf)
  if (!branches) {
    problems.push(`${where} uses "anyOf", which is supported only as the nullable form: exactly two branches, a typed schema and {"type": "null"}`)
    return undefined
  }
  const inner = compileNode(branches.typed, path, problems)
  if (!inner) {return undefined}
  if (!inner.types || inner.types.length === 0 || inner.types.includes('null')) {
    problems.push(`${where} uses "anyOf", and its typed branch does not declare a non-null "type"`)
    return undefined
  }
  if (inner.nullable) {
    problems.push(`${where} uses "anyOf" nested inside a nullable "anyOf"; only one level is supported`)
    return undefined
  }
  return problems.length > before ? undefined : { ...inner, nullable: true }
}

/** The typed branch of a nullable form, or undefined when the anyOf is not exactly that shape. */
function nullableBranches(anyOf: unknown): { typed: unknown } | undefined {
  if (!Array.isArray(anyOf) || anyOf.length !== 2) {return undefined}
  const isNullBranch = (branch: unknown): boolean =>
    isPlainObject(branch) && branch.type === 'null' && Object.keys(branch).every(key => key === 'type' || ANNOTATIONS.has(key))
  const [first, second] = anyOf
  if (isNullBranch(second) && !isNullBranch(first)) {return { typed: first }}
  if (isNullBranch(first) && !isNullBranch(second)) {return { typed: second }}
  return undefined
}

function numberKeyword(schema: Record<string, unknown>, key: string, where: string, problems: string[]): number | undefined {
  if (schema[key] === undefined) {return undefined}
  if (typeof schema[key] !== 'number' || !Number.isFinite(schema[key])) {
    problems.push(`${where} has "${key}" that is not a finite number`)
    return undefined
  }
  return schema[key] as number
}

function countKeyword(schema: Record<string, unknown>, key: string, where: string, problems: string[]): number | undefined {
  if (schema[key] === undefined) {return undefined}
  const value = schema[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    problems.push(`${where} has "${key}" that is not a non-negative integer`)
    return undefined
  }
  return value
}

function check(node: SchemaNode, value: unknown, path: string, errors: string[]): void {
  const label = path || 'arguments'
  if (node.nullable && value === null) {return}
  if (node.types && !node.types.some(type => matchesType(value, type))) {
    errors.push(`${label}: expected ${node.types.join(' or ')}`)
    return
  }
  if (node.hasConst && !deepEqual(value, node.constValue)) {
    errors.push(`${label}: must be ${JSON.stringify(node.constValue)}`)
  }
  if (node.enumValues && !node.enumValues.some(candidate => deepEqual(candidate, value))) {
    errors.push(`${label}: must be one of ${node.enumValues.map(v => JSON.stringify(v)).join(', ')}`)
  }

  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum) {errors.push(`${label}: must be at least ${node.minimum}`)}
    if (node.maximum !== undefined && value > node.maximum) {errors.push(`${label}: must be at most ${node.maximum}`)}
    if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) {errors.push(`${label}: must be greater than ${node.exclusiveMinimum}`)}
    if (node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) {errors.push(`${label}: must be less than ${node.exclusiveMaximum}`)}
  }

  if (typeof value === 'string') {
    const length = [...value].length
    if (node.minLength !== undefined && length < node.minLength) {errors.push(`${label}: must be at least ${node.minLength} characters`)}
    if (node.maxLength !== undefined && length > node.maxLength) {errors.push(`${label}: must be at most ${node.maxLength} characters`)}
    if (node.pattern && !node.pattern.test(value)) {errors.push(`${label}: does not match the required pattern`)}
  }

  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) {errors.push(`${label}: must have at least ${node.minItems} items`)}
    if (node.maxItems !== undefined && value.length > node.maxItems) {errors.push(`${label}: must have at most ${node.maxItems} items`)}
    if (node.items) {
      value.forEach((item, index) => check(node.items!, item, `${path}[${index}]`, errors))
    }
  }

  if (isPlainObject(value)) {
    for (const name of node.required) {
      if (value[name] === undefined) {errors.push(`${joinPath(path, name)}: is required`)}
    }
    for (const [name, sub] of Object.entries(node.properties)) {
      if (value[name] !== undefined) {check(sub, value[name], joinPath(path, name), errors)}
    }
    if (!node.additionalProperties) {
      for (const key of Object.keys(value)) {
        if (!(key in node.properties)) {errors.push(`${joinPath(path, key)}: is not an allowed argument`)}
      }
    }
  }
}

function matchesType(value: unknown, type: JsonType): boolean {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'array': return Array.isArray(value)
    case 'object': return isPlainObject(value)
    case 'null': return value === null
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {return true}
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {return false}
  if (Array.isArray(a) !== Array.isArray(b)) {return false}
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))
  }
  const keysA = Object.keys(a as object)
  const keysB = Object.keys(b as object)
  return keysA.length === keysB.length && keysA.every(key => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function joinPath(path: string, name: string): string {
  return path ? `${path}.${name}` : name
}
