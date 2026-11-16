/**
 * ToolGateway - the one place where an external MCP tool is discovered for the agent and called.
 *
 * Every external call the RailsForge-managed agent makes goes through here, and from here through invokeTool, so it is
 * checked by the same pipeline as RailsForge's own tools: arguments are validated, the declared risk is applied, an R3
 * call needs approval for that invocation, the call is audited, and cancellation reaches the server. Nothing else calls
 * ExternalServerManager.callTool; a static test enforces that.
 *
 * Discovery is contained. If a server cannot be reached, the agent gets no external tools for that request and the
 * reason is logged; the request still runs with its built-in tools.
 *
 * vscode-free.
 */

import type { LoopTool } from '../../agent/AgentLoop'
import { ExternalServerManager } from '../external/ExternalServerManager'
import { ExposedExternalTool, externalLoopTool } from '../external/ExternalTools'
import type { ApprovalPort } from '../policy/ToolInvocation'

export interface ToolGatewayDeps {
  /** The only connection to external servers. Reached through the gateway, never directly. */
  manager: ExternalServerManager
  /** Read on every call, so a change in workspace trust applies at once. */
  isTrusted(): boolean
  /** Asks the user for each R3 call. Without it, every R3 call is refused. */
  approval?: ApprovalPort
  warn(message: string): void
  /** Names the agent already has from RailsForge's own tools. An external tool may not take one of them. */
  nativeNames?: ReadonlySet<string>
}

export class ToolGateway {
  constructor(private readonly deps: ToolGatewayDeps) {}

  /** The external tools the agent may call for `root`, as loop tools. Empty when untrusted or when discovery fails. */
  async loopToolsFor(root: string, signal?: AbortSignal): Promise<LoopTool[]> {
    let discovered: ExposedExternalTool[]
    try {
      discovered = await this.deps.manager.toolsFor(root, this.deps.isTrusted(), signal)
    } catch (err) {
      this.deps.warn(`[mcp] external tools unavailable for this request: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
    const tools: LoopTool[] = []
    for (const tool of discovered) {
      if (this.deps.nativeNames?.has(tool.exposedName)) {
        this.deps.warn(`[mcp] "${tool.exposedName}" is not offered: it has the same name as a RailsForge tool.`)
        continue
      }
      tools.push(externalLoopTool(tool, root, {
        callRemote: (exposed, projectRoot, args, signal) => this.deps.manager.callTool(exposed.serverId, projectRoot, exposed.remoteName, args, signal),
        isTrusted: this.deps.isTrusted,
        approval: this.deps.approval,
        warn: this.deps.warn,
      }))
    }
    return tools
  }
}
