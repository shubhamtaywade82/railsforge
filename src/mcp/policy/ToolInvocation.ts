/**
 * ToolInvocation - the single path every RailsForge tool call takes: the standalone MCP server, the Language Model
 * tools, the agent loop, and external tools reached through the gateway. The order is fixed:
 *
 *   1. arguments are validated, before anything else (a malformed call never asks for approval or reaches a process);
 *   2. the declared risk is checked against the invocation context (policy);
 *   3. an R3 call asks for approval for this one invocation, and only a granted approval lets it through;
 *   4. the call is recorded as started, when the risk requires it;
 *   5. the handler runs, with the cancellation signal;
 *   6. the outcome is recorded.
 *
 * A refused call never reaches the handler, and every decision is written to the audit trail with argument names only.
 *
 * vscode-free.
 */

import { randomUUID } from 'crypto'
import { UntrustedWorkspaceError } from '../../workspace/Trust'
import { AuditRootMissingError, McpAuditEvent, McpAuditRecorder } from '../audit/McpAuditRecorder'
import { decideInvocation, InvocationSource, RiskLevel } from './McpCapabilityPolicy'

/** How long an approval prompt may wait for an answer before the call is treated as not approved. */
export const APPROVAL_TIMEOUT_MS = 60_000

export interface InvocableTool<C> {
  name: string
  risk: RiskLevel
  /** Human-readable purpose, shown to the user when an R3 call asks for approval. */
  description?: string
  /** Returns a reason when the arguments are not acceptable. Runs before policy, approval and any process start. */
  validate?(input: Record<string, unknown>): string | undefined
  handler(ctx: C, input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolOutput>
}

/**
 * What a handler returns: the text a person or model reads, or the text together with the structured value it describes.
 * A structured value is an object, because MCP's structuredContent must be one. The text is always present.
 */
export type ToolOutput = string | { text: string; data: Record<string, unknown> }

/** A failure the handler wants reported under a specific code, such as CANCELLED or TIMEOUT. */
export class ToolCallError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ToolCallError'
  }
}

/** What the user is asked to approve. It identifies the tool, the arguments, the workspace and the operation. */
export interface ApprovalRequest {
  requestId: string
  tool: string
  risk: RiskLevel
  source: InvocationSource
  workspaceRoot: string
  operation: string
  /** Argument names, sorted. Shown and audited. */
  argumentNames: string[]
  /** The argument values, clipped, shown only to the user who is approving. Never written to the audit trail. */
  argumentPreview: string
}

export type ApprovalAnswer = 'granted' | 'denied'

/** Asks the user. Implementations must answer, or reject; a rejection is treated as not approved. */
export interface ApprovalPort {
  request(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalAnswer>
}

export interface InvocationOptions {
  source: InvocationSource
  /** Read on every call, so a change in workspace trust applies at once. */
  isTrusted(): boolean
  /** Defaults to a recorder for the context's workspace root. */
  audit?: McpAuditRecorder
  /** Receives audit-write problems that do not change the outcome. */
  warn?(message: string): void
  /** Required for R3 calls to run. Without it an R3 call is refused, as it always was for native tools. */
  approval?: ApprovalPort
  /** Cancels the call: while waiting for approval, before the handler runs, and inside the handler. */
  signal?: AbortSignal
  approvalTimeoutMs?: number
  now?(): Date
  newRequestId?(): string
}

export type InvocationResult =
  | { ok: true; text: string; data?: Record<string, unknown> }
  | { ok: false; code: string; message: string }

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
  const args = input ?? {}
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
    argumentNames: Object.keys(args).sort(),
    startedAt: started.toISOString(),
  }
  let approval: 'granted' | 'denied' | 'unavailable' | undefined
  const close = (phase: 'finished' | 'denied', outcome: 'success' | 'failure' | 'denied', errorCode?: string): void => {
    const completed = now()
    const event: McpAuditEvent = {
      ...base,
      phase,
      completedAt: completed.toISOString(),
      durationMs: completed.getTime() - started.getTime(),
      outcome,
      errorCode,
      approval,
    }
    write(audit, event, warn)
  }
  const refuse = (code: string, message: string): InvocationResult => {
    close('denied', 'denied', code)
    return { ok: false, code, message: `RailsForge: ${tool.name} was not run. ${message}` }
  }

  // 1. Arguments first: a malformed call is refused before policy, before approval and before any process starts.
  const problem = tool.validate?.(args)
  if (problem) {return refuse('INVALID_ARGUMENTS', problem)}

  // 2. Policy, with the call as it stands.
  let decision = decideInvocation(tool.risk, { source: options.source, trusted })

  // 3. R3: ask for approval for this one call. A refusal, a timeout, a cancellation or a failing prompt all leave it denied.
  if (!decision.allowed && decision.code === 'APPROVAL_REQUIRED' && options.approval) {
    const answer = await askApproval(options, tool, args, base.requestId, ctx.workspaceRoot)
    approval = answer
    if (options.signal?.aborted) {return refuse('CANCELLED', 'The operation was cancelled while waiting for approval.')}
    if (answer !== 'granted') {
      return refuse(answer === 'denied' ? 'APPROVAL_DENIED' : 'APPROVAL_UNAVAILABLE', answer === 'denied'
        ? 'The user did not approve this call.'
        : 'No answer to the approval request, so the call was not approved.')
    }
    decision = decideInvocation(tool.risk, { source: options.source, trusted, approved: true })
  } else if (!decision.allowed && decision.code === 'APPROVAL_REQUIRED') {
    approval = 'unavailable'
  }
  if (!decision.allowed) {return refuse(decision.code, decision.message)}

  if (options.signal?.aborted) {return refuse('CANCELLED', 'The operation was cancelled before the tool ran.')}

  if (requiresStartedRecord(tool.risk)) {
    try {
      audit.record({ ...base, approval, phase: 'started' })
    } catch (err) {
      return { ok: false, code: 'AUDIT_UNAVAILABLE', message: `RailsForge: ${tool.name} was not run, because its audit record could not be written: ${describe(err)}` }
    }
  }

  try {
    const output = await tool.handler(ctx, args, options.signal)
    close('finished', 'success')
    return typeof output === 'string' ? { ok: true, text: output } : { ok: true, text: output.text, data: output.data }
  } catch (err) {
    // A failure after the call was cancelled is the cancellation, whatever the handler reported: the work stopped because
    // of it, not because the tool failed.
    if (options.signal?.aborted && !(err instanceof UntrustedWorkspaceError)) {
      close('finished', 'failure', 'CANCELLED')
      return { ok: false, code: 'CANCELLED', message: 'The operation was cancelled.' }
    }
    if (err instanceof UntrustedWorkspaceError) {
      // The process layer refused, which means the policy and the process layer disagree. Record it as a denial.
      close('denied', 'denied', 'WORKSPACE_UNTRUSTED')
      return { ok: false, code: 'WORKSPACE_UNTRUSTED', message: err.message }
    }
    if (err instanceof ToolCallError) {
      close('finished', 'failure', err.code)
      return { ok: false, code: err.code, message: err.message }
    }
    close('finished', 'failure', 'TOOL_FAILED')
    return { ok: false, code: 'TOOL_FAILED', message: describe(err) }
  }
}

/** Asks the port, bounded by a timeout and the cancellation signal. Any failure is 'unavailable', never 'granted'. */
async function askApproval<C>(
  options: InvocationOptions,
  tool: InvocableTool<C>,
  args: Record<string, unknown>,
  requestId: string,
  workspaceRoot: string,
): Promise<'granted' | 'denied' | 'unavailable'> {
  const port = options.approval
  if (!port) {return 'unavailable'}
  const request: ApprovalRequest = {
    requestId,
    tool: tool.name,
    risk: tool.risk,
    source: options.source,
    workspaceRoot,
    operation: tool.description ?? `Run ${tool.name}`,
    argumentNames: Object.keys(args).sort(),
    argumentPreview: preview(args),
  }
  // An operation that is already cancelled gets no prompt at all.
  if (options.signal?.aborted) {return 'unavailable'}
  const timeoutMs = options.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS
  // The port gets its own signal. It aborts when the operation is cancelled, when the wait ends (answer, timeout or
  // cancellation), so the port can dismiss the prompt on screen. A late answer after that point is ignored: the race
  // below has already settled, and invokeTool refuses a cancelled call whatever the port says.
  const prompt = new AbortController()
  let resolveSettled: (value: 'unavailable') => void = () => undefined
  const settled = new Promise<'unavailable'>(resolve => { resolveSettled = resolve })
  const onCancel = (): void => resolveSettled('unavailable')
  const timer = setTimeout(onCancel, timeoutMs)
  options.signal?.addEventListener('abort', onCancel, { once: true })
  try {
    // A port that rejects is treated as not answering, which is refused like a timeout.
    const answered = port.request(request, prompt.signal).catch((): 'unavailable' => 'unavailable')
    const answer = await Promise.race([answered, settled])
    return answer === 'granted' ? 'granted' : answer === 'denied' ? 'denied' : 'unavailable'
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onCancel)
    prompt.abort()
  }
}

/** A short, value-bearing preview for the approval prompt. It is clipped; it is never written to the audit trail. */
export function preview(args: Record<string, unknown>): string {
  const text = JSON.stringify(args)
  return text.length > 400 ? `${text.slice(0, 400)}…` : text
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
