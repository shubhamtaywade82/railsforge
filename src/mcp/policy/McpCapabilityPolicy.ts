/**
 * McpCapabilityPolicy - decides whether one tool invocation may run, from the risk level the tool declares.
 *
 * Risk levels (RailsForge MCP specification, section 10):
 *   R0  static reads: AST, schema, routes, documentation, the persistent index
 *   R1  reads of cached data, such as the runtime snapshot; no execution
 *   R2  runs project-controlled code: rake, bundle exec, RuboCop, test runners
 *   R3  boots the application or attaches to a process; needs per-call approval, which this build does not provide
 *   R4  arbitrary evaluation, database writes, arbitrary shell; never exposed
 *
 * vscode-free. The standalone MCP server and the extension host make the same decision. They differ only in where
 * "trusted" comes from: the explicit grant in the server's environment, or VS Code workspace trust.
 */

export type RiskLevel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4'

/** standalone: the MCP server process. host: the extension (Language Model tools and the agent loop). */
export type InvocationSource = 'standalone' | 'host'

export type DenialCode = 'EXECUTION_DISABLED' | 'WORKSPACE_UNTRUSTED' | 'APPROVAL_REQUIRED' | 'DISABLED_BY_POLICY'

export type PolicyDecision = { allowed: true } | { allowed: false; code: DenialCode; message: string }

export interface InvocationContext {
  source: InvocationSource
  /** Whether project code may run right now: VS Code workspace trust in the host, the explicit grant when standalone. */
  trusted: boolean
}

/** The variable through which the MCP client grants project execution to the standalone server. */
export const EXECUTION_ENV = 'RAILSFORGE_MCP_EXECUTION'

export type ExecutionGrant = 'none' | 'project-code'

export interface ExecutionGrantReading {
  grant: ExecutionGrant
  /** Set when the variable holds a value that is not recognised. The grant then stays 'none'. */
  warning?: string
}

/**
 * Reads the standalone execution grant from the environment the MCP client launched the server with.
 * Only the value `project-code` (case-insensitive, trimmed) grants project execution. Anything else, including
 * `true`, `all` or a list, grants nothing.
 */
export function readExecutionGrant(env: Readonly<Record<string, string | undefined>>): ExecutionGrantReading {
  const raw = env[EXECUTION_ENV]
  const value = raw === undefined ? '' : raw.trim().toLowerCase()
  if (value === '' || value === 'none') {return { grant: 'none' }}
  if (value === 'project-code') {return { grant: 'project-code' }}
  return {
    grant: 'none',
    warning: `${EXECUTION_ENV} has an unrecognised value, so project code stays disabled. Expected "none" or "project-code".`,
  }
}

export function decideInvocation(risk: RiskLevel, context: InvocationContext): PolicyDecision {
  switch (risk) {
    case 'R0':
    case 'R1':
      return { allowed: true }
    case 'R2':
      if (context.trusted) {return { allowed: true }}
      return context.source === 'standalone'
        ? denied('EXECUTION_DISABLED', `The standalone MCP server runs project code only after an explicit grant. Set ${EXECUTION_ENV}=project-code in the environment that launches the server to allow it.`)
        : denied('WORKSPACE_UNTRUSTED', 'This tool runs project code, which is disabled in Restricted Mode. Trust this workspace to enable it.')
    case 'R3':
      return denied('APPROVAL_REQUIRED', 'This tool needs per-call approval, which this build does not provide.')
    case 'R4':
      return denied('DISABLED_BY_POLICY', 'RailsForge never exposes this capability.')
  }
}

function denied(code: DenialCode, message: string): PolicyDecision {
  return { allowed: false, code, message }
}
