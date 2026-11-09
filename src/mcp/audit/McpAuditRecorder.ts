/**
 * McpAuditRecorder - appends one JSON line per tool invocation event to .railsforge/mcp/audit.jsonl.
 *
 * A record names the tool, its risk level, its source, and the names of its input fields. It never holds input
 * values, tool output or environment variables. The .railsforge/ directory is git-ignored. vscode-free.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { InvocationSource, RiskLevel } from '../policy/McpCapabilityPolicy'

export const AUDIT_RELATIVE_PATH = path.join('.railsforge', 'mcp', 'audit.jsonl')

export type AuditPhase = 'started' | 'finished' | 'denied'
export type AuditOutcome = 'success' | 'failure' | 'denied'

export interface McpAuditEvent {
  requestId: string
  phase: AuditPhase
  tool: string
  risk: RiskLevel
  source: InvocationSource
  trusted: boolean
  /** Names of the input fields, sorted. Values are never recorded. */
  argumentNames: string[]
  startedAt: string
  completedAt?: string
  durationMs?: number
  outcome?: AuditOutcome
  errorCode?: string
}

/** Thrown when the workspace root does not exist, so there is nowhere to write an audit trail. */
export class AuditRootMissingError extends Error {
  readonly code = 'AUDIT_ROOT_MISSING'

  constructor(root: string) {
    super(`workspace root does not exist: ${root}`)
    this.name = 'AuditRootMissingError'
  }
}

/** Once the audit file reaches this size it is rotated. One previous generation is kept, so the trail stays bounded. */
export const AUDIT_ROTATE_BYTES = 1024 * 1024

export class McpAuditRecorder {
  constructor(private readonly workspaceRoot: string) {}

  /** Appends the event. Throws AuditRootMissingError when the root is missing, and another error when the write fails. */
  record(event: McpAuditEvent): void {
    if (!fs.existsSync(this.workspaceRoot)) {throw new AuditRootMissingError(this.workspaceRoot)}
    const file = path.join(this.workspaceRoot, AUDIT_RELATIVE_PATH)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    rotateIfLarge(file)
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8')
  }
}

/** Moves a full audit file to `<name>.1`, replacing the previous generation. A missing file has nothing to rotate. */
function rotateIfLarge(file: string): void {
  let size: number
  try {
    size = fs.statSync(file).size
  } catch {
    return
  }
  if (size >= AUDIT_ROTATE_BYTES) {fs.renameSync(file, `${file}.1`)}
}
