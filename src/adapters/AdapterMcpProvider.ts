/**
 * AdapterMcpProvider - offers the agent the optional tools that AdapterAgentServers selects, as MCP servers.
 *
 * It registers through the same host API that serves RailsForge's own MCP server, and it is feature-detected the same
 * way. Nothing is offered in an untrusted workspace, nothing is probed unless a tool is enabled and allowed, and a
 * failure offers nothing rather than throwing into the host.
 */

import * as vscode from 'vscode'
import { Logger } from '../util/Logger'
import { isWorkspaceTrusted } from '../workspace/Trust'
import { agentServerPlans } from './AdapterAgentServers'
import { isAdapterId } from './AdapterCatalog'
import { reportAdapters } from './AdapterService'

export const ADAPTER_MCP_PROVIDER_ID = 'railsforge.adapters'

type McpStdioCtor = new (
  label: string,
  command: string,
  args?: string[],
  env?: Record<string, string | number | null>,
  version?: string,
) => unknown

export function registerAdapterMcpProvider(context: vscode.ExtensionContext, rootOf: () => string | undefined): void {
  const lm = (vscode as unknown as { lm?: { registerMcpServerDefinitionProvider?: unknown } }).lm
  const McpStdio = (vscode as unknown as { McpStdioServerDefinition?: McpStdioCtor }).McpStdioServerDefinition
  if (typeof lm?.registerMcpServerDefinitionProvider !== 'function' || !McpStdio) {
    Logger.debug('MCP server definitions are unavailable in this host, so optional tools are not offered to the agent.')
    return
  }

  const changed = new vscode.EventEmitter<void>()
  context.subscriptions.push(
    changed,
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('railsForge.adapters')) {changed.fire()}
    }),
  )

  const provider = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: async (): Promise<unknown[]> => {
      try {
        const root = rootOf()
        if (!root || !isWorkspaceTrusted()) {return []}
        const config = vscode.workspace.getConfiguration('railsForge')
        const enabled = (config.get<string[]>('adapters.enabled', []) ?? []).filter(isAdapterId)
        const executionAllowed = (config.get<string[]>('adapters.agentExecution', []) ?? []).filter(isAdapterId)
        if (enabled.length === 0 || executionAllowed.length === 0) {return []}
        const reports = await reportAdapters(root, enabled)
        return agentServerPlans({ reports, enabled, executionAllowed, root }).map(
          plan => new McpStdio(plan.label, plan.command, [...plan.args], undefined, plan.version),
        )
      } catch (err) {
        Logger.warn(`[adapters] agent servers unavailable: ${String(err)}`)
        return []
      }
    },
  }
  context.subscriptions.push(
    (lm.registerMcpServerDefinitionProvider as (id: string, p: unknown) => vscode.Disposable)(ADAPTER_MCP_PROVIDER_ID, provider),
  )
  Logger.info('Registered the optional-tools MCP server definition provider.')
}
