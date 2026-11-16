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
import { ApprovalPort, InvocableTool, ToolCallError, invokeTool } from '../policy/ToolInvocation'
import { LoopToolError } from '../../agent/AgentLoop'
import { ExternalCallError } from './ExternalServerManager'
import { SchemaNode, compileObjectSchema, validateValue } from './JsonSchemaSubset'
import type { DeclaredToolRisk } from './ExternalServerConfig'

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
  /** The server's schema as declared, shown to the model. */
  jsonSchema: Record<string, unknown>
  /** The schema compiled for validation. Arguments are checked against this, never against the declared text. */
  schema: SchemaNode
  /** R2 runs without a prompt in a trusted workspace; R3 asks before every call. Set from the user's configuration. */
  risk: DeclaredToolRisk
}

export interface ExposeResult {
  tools: ExposedExternalTool[]
  problems: string[]
}

/** Applies the allowlist to a server's listed tools. Anything not allowed, invalid or over the cap is left out and reported. */
export function exposeTools(
  serverId: string,
  listed: readonly RemoteToolDescriptor[],
  allowTools: readonly string[],
  toolRisk: Readonly<Record<string, DeclaredToolRisk>> = {},
): ExposeResult {
  const problems: string[] = []
  const byName = new Map(listed.map(tool => [tool.name, tool]))
  const tools: ExposedExternalTool[] = []
  for (const name of new Set(allowTools)) {
    const remote = byName.get(name)
    if (!remote) {
      problems.push(`allowTools lists "${name}", which ${serverId} does not provide.`)
      continue
    }
    const compiled = compileObjectSchema(remote.inputSchema)
    if (!compiled.ok) {
      // A schema that cannot be enforced is not offered: it is never silently relaxed.
      problems.push(`"${name}" was not offered: its input schema is not supported (${compiled.problems.join('; ')}).`)
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
      schema: compiled.root,
      risk: toolRisk[name] ?? 'R3',
    })
  }
  return { tools, problems }
}

export interface ExternalToolDeps {
  /** Calls the remote tool in the session for `root` and resolves with the text the server returned. */
  callRemote(tool: ExposedExternalTool, root: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>
  /** Read on every call, so a change in workspace trust applies at once. */
  isTrusted(): boolean
  /** Asks the user for each R3 call. Without it an R3 call is refused. */
  approval?: ApprovalPort
  warn?(message: string): void
}

export type ArgCheck = { ok: true; args: Record<string, unknown> } | { ok: false; message: string }

/**
 * Builds the loop tool the agent calls. Every call goes through invokeTool: arguments are validated first, the policy
 * and the per-call approval apply, and the outcome is audited. A failure is reported to the loop with its code.
 */
export function externalLoopTool(tool: ExposedExternalTool, root: string, deps: ExternalToolDeps): LoopTool {
  const definition: InvocableTool<{ workspaceRoot: string }> = {
    name: tool.exposedName,
    risk: tool.risk,
    description: `${tool.description} (${tool.serverId}: ${tool.remoteName})`,
    validate: input => {
      const result = validateValue(tool.schema, input)
      return result.ok ? undefined : result.errors.join('; ')
    },
    handler: async (_ctx, input, signal) => {
      try {
        return await deps.callRemote(tool, root, input, signal)
      } catch (err) {
        if (err instanceof ExternalCallError) {throw new ToolCallError(err.code, err.message)}
        throw err
      }
    },
  }
  return {
    name: tool.exposedName,
    description: tool.description,
    inputSchema: {},
    jsonSchema: tool.jsonSchema,
    checkArgs: args => checkWithSchema(tool.schema, args),
    run: async (args, signal) => {
      const result = await invokeTool(definition, { workspaceRoot: root }, args, {
        source: 'host',
        isTrusted: deps.isTrusted,
        warn: deps.warn,
        approval: deps.approval,
        signal,
      })
      if (result.ok) {return result.text}
      throw new LoopToolError(result.code, result.message)
    },
  }
}

/** Validates arguments against a compiled schema. Every error is returned in one message. */
export function checkWithSchema(schema: SchemaNode, args: Record<string, unknown>): ArgCheck {
  const result = validateValue(schema, args)
  return result.ok ? { ok: true, args } : { ok: false, message: result.errors.join('; ') }
}

/** Compiles a declared schema and checks arguments against it. An unsupported schema is a failure, not a pass. */
export function checkArguments(schema: Record<string, unknown>, args: Record<string, unknown>): ArgCheck {
  const compiled = compileObjectSchema(schema)
  if (!compiled.ok) {return { ok: false, message: `the tool's input schema is not supported: ${compiled.problems.join('; ')}` }}
  return checkWithSchema(compiled.root, args)
}
