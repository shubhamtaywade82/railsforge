/**
 * EditorProvider - registers the external servers that are opted in with `exposeToEditor` as MCP definitions, so the
 * editor's own agent (Copilot, Cursor) can start them. The policy is in EditorDefinitions.ts; this file only talks to
 * the host.
 *
 * The host calls provideMcpServerDefinitions eagerly and must not prompt there, so this provider only returns
 * definitions. It never starts a process. Its problems are logged once each, not on every call.
 */

import * as vscode from 'vscode'
import type { ExternalServerSpec } from './ExternalServerConfig'
import { EditorPlan, planEditorDefinitions } from './EditorDefinitions'

export const EDITOR_PROVIDER_ID = 'railsforge.external'

type McpStdioCtor = new (
  label: string,
  command: string,
  args?: string[],
  env?: Record<string, string | number | null>,
  version?: string,
) => { cwd?: vscode.Uri }

export interface EditorProviderDeps {
  readServers(): readonly ExternalServerSpec[]
  roots(): string[]
  isTrusted(): boolean
  hostVersion: string
  log(message: string): void
}

/** The plan the provider would return now. Used by the test API, so the same policy is exercised end to end. */
export function currentEditorPlan(deps: EditorProviderDeps): EditorPlan {
  return planEditorDefinitions({
    servers: deps.readServers(),
    roots: deps.roots(),
    trusted: deps.isTrusted(),
    hostVersion: deps.hostVersion,
  })
}

/** Returns false, and registers nothing, when the host has no MCP definition API (VS Code 1.96, for example). */
export function registerEditorExternalProvider(context: vscode.ExtensionContext, deps: EditorProviderDeps): boolean {
  const lm = (vscode as unknown as { lm?: { registerMcpServerDefinitionProvider?: unknown } }).lm
  const McpStdio = (vscode as unknown as { McpStdioServerDefinition?: McpStdioCtor }).McpStdioServerDefinition
  if (typeof lm?.registerMcpServerDefinitionProvider !== 'function' || !McpStdio) {
    deps.log('MCP server definitions are unavailable in this host, so external servers are not offered to the editor\'s agent.')
    return false
  }

  const changed = new vscode.EventEmitter<void>()
  let lastProblem: string | undefined
  context.subscriptions.push(
    changed,
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('railsForge.mcp')) {changed.fire()}
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()),
  )

  const provider = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: (): unknown[] => {
      const plan = currentEditorPlan(deps)
      for (const problem of plan.problems) {
        if (problem !== lastProblem) {
          lastProblem = problem
          deps.log(`[mcp] ${problem}`)
        }
      }
      return plan.definitions.map(definition => {
        const server = new McpStdio(definition.label, definition.command, definition.args, definition.env, definition.version)
        server.cwd = vscode.Uri.file(definition.cwd)
        return server
      })
    },
  }
  context.subscriptions.push(
    (lm.registerMcpServerDefinitionProvider as (id: string, p: unknown) => vscode.Disposable)(EDITOR_PROVIDER_ID, provider),
  )
  return true
}
