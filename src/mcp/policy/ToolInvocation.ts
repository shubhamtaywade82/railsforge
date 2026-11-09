/**
 * ToolInvocation - the single path every RailsForge tool call takes: the standalone MCP server, the Language Model
 * tools and the agent loop. It checks the declared risk against the invocation context, writes audit records, and
 * only then runs the handler. A refused call never reaches the handler.
 *
 * vscode-free.
 */

import { randomUUID } from 'crypto'
import { UntrustedWorkspaceError } from '../../workspace/Trust'
import { AuditRootMissingError, McpAuditEvent, McpAuditRecorder } from '../audit/McpAuditRecorder'
import { decideInvocation, InvocationSource, RiskLevel } from './McpCapabilityPolicy'

export interface InvocableTool<C> {
  name: string
  risk: RiskLevel
  handler(ctx: C, input: Record<string, unknown>): Promise<string>
}

export interface InvocationOptions {
  source: InvocationSource
  /** Read on every call, so a change in workspace trust or in the grant applies at once. */
  isTrusted(): boolean
  /** Defaults to a recorder for the context's workspace root. */
  audit?: McpAuditRecorder
  /** Receives audit-write problems that do not change the outcome. */
  warn?(message: string): void
  now?(): Date
  newRequestId?(): string
}

export type InvocationResult = { ok: true; text: string } | { ok: false; code: string; message: string }

/** Calls at these risk levels leave a 'started' record before they run, so no execution goes unrecorded. */
function requiresStartedRecord(risk: RiskLevel): boolean {
  return risk === 'R2' || risk === 'R3' || risk === 'R4'
}

export async function invokeTool<C extends { workspaceRoot: string }>(
  tool: InvocableTool<C>,
  ctx: C,
  input: Record<string, unknown>,
  options: InvocationOptions,
): Promise<InvocationResult> {
  const audit = options.audit ?? new McpAuditRecorder(ctx.workspaceRoot)
  const warn = options.warn ?? (() => undefined)
  const now = options.now ?? (() => new Date())
  const started = now()
  const trusted = readTrust(options.isTrusted)
  const base = {
    requestId: (options.newRequestId ?? randomUUID)(),
    tool: tool.name,
    risk: tool.risk,
    source: options.source,
    trusted,
    argumentNames: Object.keys(input ?? {}).sort(),
    startedAt: started.toISOString(),
  }
  const close = (phase: 'finished' | 'denied', outcome: 'success' | 'failure' | 'denied', errorCode?: string): void => {
    const completed = now()
    const event: McpAuditEvent = {
      ...base,
      phase,
      completedAt: completed.toISOString(),
      durationMs: completed.getTime() - started.getTime(),
      outcome,
      errorCode,
    }
    write(audit, event, warn)
  }

  const decision = decideInvocation(tool.risk, { source: options.source, trusted })
  if (!decision.allowed) {
    close('denied', 'denied', decision.code)
    return { ok: false, code: decision.code, message: `RailsForge: ${tool.name} was not run. ${decision.message}` }
  }

  if (requiresStartedRecord(tool.risk)) {
    try {
      audit.record({ ...base, phase: 'started' })
    } catch (err) {
      return { ok: false, code: 'AUDIT_UNAVAILABLE', message: `RailsForge: ${tool.name} was not run, because its audit record could not be written: ${describe(err)}` }
    }
  }

  try {
    const text = await tool.handler(ctx, input ?? {})
    close('finished', 'success')
    return { ok: true, text }
  } catch (err) {
    if (err instanceof UntrustedWorkspaceError) {
      // The process layer refused, which means the policy and the process layer disagree. Record it as a denial.
      close('denied', 'denied', 'WORKSPACE_UNTRUSTED')
      return { ok: false, code: 'WORKSPACE_UNTRUSTED', message: err.message }
    }
    close('finished', 'failure', 'TOOL_FAILED')
    return { ok: false, code: 'TOOL_FAILED', message: describe(err) }
  }
}

function write(audit: McpAuditRecorder, event: McpAuditEvent, warn: (message: string) => void): void {
  try {
    audit.record(event)
  } catch (err) {
    // A missing workspace root has no audit trail to keep, so it is not worth a warning.
    if (!(err instanceof AuditRootMissingError)) {warn(`audit record not written: ${describe(err)}`)}
  }
}

function readTrust(isTrusted: () => boolean): boolean {
  try {
    return isTrusted() === true
  } catch {
    return false // fail closed: trust that cannot be read is trust that is not granted
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
