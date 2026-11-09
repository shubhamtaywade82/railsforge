/**
 * AdapterAgentServers - decides which optional tools the agent may use as MCP servers, and how each one starts.
 *
 * A tool is offered only when every condition holds:
 *   - the user enabled it (railsForge.adapters.enabled);
 *   - the user listed it in railsForge.adapters.agentExecution, because each offered tool can run code that the agent
 *     supplies, so that consent is separate from installing it;
 *   - it is installed globally. A project install needs the application root as its working directory, and the
 *     server definition does not set one, so project installs are not offered;
 *   - its stdio start command is stated in its own README (AGENT_SERVERS).
 * Nothing else is offered. A tool that is missing, unchecked, too old for its Ruby, or not verified is never started.
 *
 * `launch.cwd` is not used: a global tool starts without a working directory.
 *
 * vscode-free.
 */

import type { AdapterId } from './AdapterCatalog'
import type { AdapterReport } from './AdapterService'
import { launchSpecFor } from './AdapterStatus'

/** Tools whose stdio transport and start command are stated in their own README, with the statement checked. */
export const AGENT_SERVERS: Readonly<Partial<Record<AdapterId, string>>> = {
  'debug-mcp': 'README: stdio is the default transport, and `debug-mcp` with no flags starts it.',
}

export interface AgentServerPlan {
  adapter: AdapterId
  label: string
  command: string
  args: readonly string[]
  version?: string
}

export interface AgentServerInput {
  reports: readonly AdapterReport[]
  enabled: readonly AdapterId[]
  executionAllowed: readonly AdapterId[]
  root: string
}

export function agentServerPlans(input: AgentServerInput): AgentServerPlan[] {
  const plans: AgentServerPlan[] = []
  for (const { entry, state } of input.reports) {
    if (AGENT_SERVERS[entry.id] === undefined) {continue}
    if (!input.enabled.includes(entry.id) || !input.executionAllowed.includes(entry.id)) {continue}
    if (state.kind !== 'installed' || state.where !== 'global') {continue}
    const launch = launchSpecFor(entry, state, input.root)
    if (!launch) {continue}
    plans.push({
      adapter: entry.id,
      label: `${entry.label} (RailsForge)`,
      command: launch.command,
      args: launch.args,
      version: state.version,
    })
  }
  return plans
}
