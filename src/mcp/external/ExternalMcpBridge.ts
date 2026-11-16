/**
 * ExternalMcpBridge - joins the user's `railsForge.mcp.servers` setting, the connection manager and the agent loop.
 *
 * The agent receives external tools as ordinary loop tools, so they are shown in the same tool list, checked the same
 * way and run through the same invokeTool policy and audit as RailsForge's own tools. Nothing here starts a process
 * by itself: a server starts only when the agent is about to use one, in a trusted workspace.
 *
 * vscode-free.
 */

import type { LoopTool } from '../../agent/AgentLoop'
import { ExternalServerProblem, ExternalServerSpec, parseExternalServers } from './ExternalServerConfig'
import { ExternalServerManager, ServerStatus } from './ExternalServerManager'
import { externalLoopTool } from './ExternalTools'

export class ExternalMcpBridge {
  private problems: ExternalServerProblem[] = []
  private servers: readonly ExternalServerSpec[] = []
  private lastRaw: string | undefined

  constructor(
    private readonly manager: ExternalServerManager,
    private readonly isTrusted: () => boolean,
    private readonly log: (message: string) => void,
  ) {}

  /** Re-reads the user's setting. Invalid entries are logged and left out; the valid ones are applied. */
  reconfigure(raw: unknown): ExternalServerProblem[] {
    // Configuration changes arrive for every railsForge setting. An unchanged list is not re-applied or re-logged.
    const key = JSON.stringify(raw ?? null)
    if (key === this.lastRaw) {return this.problems}
    this.lastRaw = key
    const parsed = parseExternalServers(raw)
    this.problems = parsed.problems
    this.servers = parsed.servers
    this.manager.configure(parsed.servers)
    for (const problem of parsed.problems) {
      const where = problem.index >= 0 ? `entry ${problem.index + 1}` : 'setting'
      this.log(`[mcp] railsForge.mcp.servers ${where}${problem.id ? ` (${problem.id})` : ''}: ${problem.message}`)
    }
    return parsed.problems
  }

  /** The servers the user configured and that parsed cleanly, enabled or not. The editor path filters them itself. */
  currentServers(): readonly ExternalServerSpec[] {
    return this.servers
  }

  /**
   * The external tools the agent may call for `root`, as loop tools. Empty in an untrusted workspace. A failure here
   * leaves the agent with its built-in tools rather than failing the request.
   */
  async loopToolsFor(root: string): Promise<LoopTool[]> {
    try {
      const tools = await this.manager.toolsFor(root, this.isTrusted())
      return tools.map(tool => externalLoopTool(tool, root, {
        callRemote: (exposed, projectRoot, args) => this.manager.callTool(exposed.serverId, projectRoot, exposed.remoteName, args),
        isTrusted: this.isTrusted,
        warn: message => this.log(message),
      }))
    } catch (err) {
      this.log(`[mcp] external tools unavailable for this request: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }

  /** Markdown for the test command: each server's state, the tools it offers and the configuration problems. */
  async statusReport(root: string): Promise<string> {
    const trusted = this.isTrusted()
    const statuses = await this.manager.statusFor(root, trusted)
    return renderStatusMarkdown({ root, trusted, statuses, problems: this.problems })
  }

  dispose(): Promise<void> {
    return this.manager.dispose()
  }
}

export interface StatusReportInput {
  root: string
  trusted: boolean
  statuses: readonly ServerStatus[]
  problems: readonly ExternalServerProblem[]
}

/** Pure rendering, so the report can be tested without a server. Environment values are never included. */
export function renderStatusMarkdown(input: StatusReportInput): string {
  const lines: string[] = [
    '# RailsForge: External MCP Servers',
    '',
    `Project: \`${input.root}\``,
    `Workspace trusted: ${input.trusted ? 'yes' : 'no. Servers do not start until the workspace is trusted.'}`,
    '',
  ]
  if (input.statuses.length === 0) {
    lines.push('No servers are configured. Add entries to `railsForge.mcp.servers` in your user settings.', '')
  } else {
    lines.push('| Server | State | Offered tools | Notes |', '| :--- | :--- | :--- | :--- |')
    for (const status of input.statuses) {
      const tools = status.tools.length > 0 ? status.tools.map(name => `\`${status.id}__${name}\``).join(', ') : '—'
      const notes = [status.failure ? `failed: ${status.failure}` : '', ...status.problems].filter(Boolean).join('; ') || '—'
      lines.push(`| ${cell(status.id)} | ${status.state} | ${tools} | ${cell(notes)} |`)
    }
    lines.push('')
  }
  if (input.problems.length > 0) {
    lines.push('## Configuration problems', '')
    for (const problem of input.problems) {
      const where = problem.index >= 0 ? `Entry ${problem.index + 1}${problem.id ? ` (${problem.id})` : ''}` : 'Setting'
      lines.push(`- ${where}: ${problem.message}`)
    }
    lines.push('')
  }
  lines.push(
    '## How a tool is offered',
    '',
    '- A tool appears to the agent only when its name is listed in that server\'s `allowTools`.',
    '- Every offered tool runs in the trusted workspace, and each call is written to `.railsforge/mcp/audit.jsonl`.',
    '',
  )
  return lines.join('\n')
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}
