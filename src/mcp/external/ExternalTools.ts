/**
 * ExternalTools - decides which tools an external MCP server offers the agent, and runs them through RailsForge's
 * policy and audit path.
 *
 * Default deny: a tool is offered only when the user's `allowTools` names it. The server's own annotations (such as
 * readOnlyHint) are not trusted to grant anything, because the server describes itself.
 *
 * Every offered tool runs as risk R2, since it executes code outside RailsForge. The shared policy therefore refuses
 * it in an untrusted workspace, and every call is audited by invokeTool, which records argument names and never values.
 *
 * vscode-free.
 */

import type { LoopTool } from '../../agent/AgentLoop'
import { InvocableTool, invokeTool } from '../policy/ToolInvocation'

/** The most tools one server may offer. A larger list would crowd the agent's prompt and hide the useful tools. */
export const MAX_EXTERNAL_TOOLS_PER_SERVER = 50
/** Names the agent sees must fit the tool-name rules every model provider accepts. */
const EXPOSED_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export interface JsonSchemaProperty {
  type?: string | string[]
  description?: string
  enum?: unknown[]
}

/** One entry of a server's `tools/list` response. */
export interface RemoteToolDescriptor {
  name: string
  description?: string
  inputSchema: { type?: string; properties?: Record<string, JsonSchemaProperty>; required?: string[] }
}

export interface ExposedExternalTool {
  serverId: string
  /** The name the server knows the tool by. */
  remoteName: string
  /** The name the agent sees: `<serverId>__<remoteName>`, so two servers cannot collide with each other or with built-ins. */
  exposedName: string
  description: string
  jsonSchema: Record<string, unknown>
}

export interface ExposeResult {
  tools: ExposedExternalTool[]
  problems: string[]
}

/** Applies the allowlist to a server's listed tools. Anything not allowed, invalid or over the cap is left out and reported. */
export function exposeTools(serverId: string, listed: readonly RemoteToolDescriptor[], allowTools: readonly string[]): ExposeResult {
  const problems: string[] = []
  const byName = new Map(listed.map(tool => [tool.name, tool]))
  const tools: ExposedExternalTool[] = []
  for (const name of new Set(allowTools)) {
    const remote = byName.get(name)
    if (!remote) {
      problems.push(`allowTools lists "${name}", which ${serverId} does not provide.`)
      continue
    }
    if (remote.inputSchema?.type !== 'object') {
      problems.push(`"${name}" has no object input schema, so it is not offered.`)
      continue
    }
    const exposedName = `${serverId}__${name}`
    if (!EXPOSED_NAME_PATTERN.test(exposedName)) {
      problems.push(`"${name}" cannot be offered: the name "${exposedName}" is not valid for the agent.`)
      continue
    }
    if (tools.length >= MAX_EXTERNAL_TOOLS_PER_SERVER) {
      problems.push(`More than ${MAX_EXTERNAL_TOOLS_PER_SERVER} tools are allowed for ${serverId}; the rest are not offered.`)
      break
    }
    tools.push({
      serverId,
      remoteName: name,
      exposedName,
      description: (remote.description ?? '').trim() || `Tool "${name}" provided by ${serverId}.`,
      jsonSchema: remote.inputSchema as Record<string, unknown>,
    })
  }
  return { tools, problems }
}

export interface ExternalToolDeps {
  /** Calls the remote tool in the session for `root` and resolves with the text the server returned. */
  callRemote(tool: ExposedExternalTool, root: string, args: Record<string, unknown>): Promise<string>
  /** Read on every call, so a change in workspace trust applies at once. */
  isTrusted(): boolean
  warn?(message: string): void
}

export type ArgCheck = { ok: true; args: Record<string, unknown> } | { ok: false; message: string }

/** Builds the loop tool the agent calls. Argument checks are JSON Schema basics; the server validates the rest. */
export function externalLoopTool(tool: ExposedExternalTool, root: string, deps: ExternalToolDeps): LoopTool {
  const definition: InvocableTool<{ workspaceRoot: string }> = {
    name: tool.exposedName,
    risk: 'R2',
    handler: async (_ctx, input) => deps.callRemote(tool, root, input),
  }
  return {
    name: tool.exposedName,
    description: tool.description,
    inputSchema: {},
    jsonSchema: tool.jsonSchema,
    checkArgs: args => checkArguments(tool.jsonSchema, args),
    run: async args => {
      const result = await invokeTool(definition, { workspaceRoot: root }, args, {
        source: 'host',
        isTrusted: deps.isTrusted,
        warn: deps.warn,
      })
      if (result.ok) {return result.text}
      // A refusal is text the loop can adapt to. A failure keeps the thrown-error behaviour the loop already has.
      if (result.code === 'TOOL_FAILED') {throw new Error(result.message)}
      return result.message
    },
  }
}

/** Checks the arguments the model produced against a JSON Schema object: object shape, required keys, declared types. */
export function checkArguments(schema: Record<string, unknown>, args: Record<string, unknown>): ArgCheck {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return { ok: false, message: 'arguments must be a JSON object.' }
  }
  const properties = (schema.properties ?? {}) as Record<string, JsonSchemaProperty>
  const required = Array.isArray(schema.required) ? schema.required as string[] : []
  const missing = required.filter(key => args[key] === undefined)
  if (missing.length > 0) {return { ok: false, message: `missing required argument${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` }}
  for (const [key, value] of Object.entries(args)) {
    const declared = properties[key]?.type
    if (declared === undefined || value === undefined) {continue}
    const allowed = Array.isArray(declared) ? declared : [declared]
    if (!allowed.some(type => matchesJsonType(value, type))) {
      return { ok: false, message: `argument "${key}" must be ${allowed.join(' or ')}.` }
    }
  }
  return { ok: true, args }
}

function matchesJsonType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'array': return Array.isArray(value)
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'null': return value === null
    default: return true // a type name this checker does not know is left to the server
  }
}
