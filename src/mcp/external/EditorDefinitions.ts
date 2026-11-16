/**
 * EditorDefinitions - decides which external servers the editor's own agent (Copilot, Cursor) is offered, and how each
 * one starts. The editor starts the process itself; RailsForge only describes it.
 *
 * Trust and scope:
 *   - Only servers the user enabled with `exposeToEditor: true` are offered. Nothing else reaches the editor.
 *   - Nothing is offered in an untrusted workspace.
 *   - Each project gets its own definition, with the project as its working directory.
 *
 * What this path does not do: the editor does not apply `allowTools`, and it does not write RailsForge's audit trail.
 * Those guarantees hold only for RailsForge's own agent (ExternalServerManager). docs/external-mcp-servers.md says so.
 *
 * Working directory: the editor reads a stdio definition's `cwd` only from VS Code 1.105 on. The extension API cannot
 * ask whether a host honours it, so the gate is a version gate, checked against the shipped bundles of 1.96 (no MCP
 * definition API), 1.100 (API, no cwd) and 1.105 (API and cwd). Below the gate nothing that needs a project directory
 * is offered, rather than starting the server in the wrong directory.
 *
 * vscode-free.
 */

import { createHash } from 'crypto'
import type { ExternalServerSpec } from './ExternalServerConfig'

/** The first VS Code version whose MCP definitions honour `cwd`. See the module comment for how it was verified. */
export const EDITOR_CWD_MIN_VERSION: readonly [number, number, number] = [1, 105, 0]

export interface EditorDefinitionPlan {
  /** Stable for a given server, so the editor can match it across refreshes. */
  id: string
  label: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  /** Changes when the command or arguments change, so the editor asks the user to refresh its tools. */
  version: string
}

export interface EditorPlanInput {
  servers: readonly ExternalServerSpec[]
  roots: readonly string[]
  trusted: boolean
  /** The host's version string, for example "1.146.0" or "1.105.0-insider". */
  hostVersion: string
}

export interface EditorPlan {
  definitions: EditorDefinitionPlan[]
  problems: string[]
}

/** True when a host version is at or above EDITOR_CWD_MIN_VERSION. An unreadable version is not supported. */
export function hostSupportsEditorCwd(hostVersion: string | undefined): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(hostVersion ?? '')
  if (!match) {return false}
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const [minMajor, minMinor, minPatch] = EDITOR_CWD_MIN_VERSION
  if (major !== minMajor) {return major > minMajor}
  if (minor !== minMinor) {return minor > minMinor}
  return patch >= minPatch
}

export function planEditorDefinitions(input: EditorPlanInput): EditorPlan {
  const eligible = input.servers.filter(server => server.enabled && server.exposeToEditor)
  if (!input.trusted || eligible.length === 0 || input.roots.length === 0) {
    return { definitions: [], problems: [] }
  }
  if (!hostSupportsEditorCwd(input.hostVersion)) {
    return {
      definitions: [],
      problems: [`VS Code ${input.hostVersion || 'unknown'} cannot set the working directory of an MCP server (needs ${EDITOR_CWD_MIN_VERSION.join('.')} or later), so ${eligible.map(s => s.id).join(', ')} is not offered to the editor's agent.`],
    }
  }
  const multiRoot = input.roots.length > 1
  const definitions: EditorDefinitionPlan[] = []
  for (const root of input.roots) {
    for (const server of eligible) {
      const folder = baseName(root)
      const id = multiRoot ? `${server.id}-${hash(root).slice(0, 8)}` : server.id
      definitions.push({
        id,
        label: multiRoot ? `${server.id} (${folder})` : server.id,
        command: server.command,
        args: [...server.args],
        env: { ...server.env },
        cwd: root,
        version: hash(JSON.stringify([server.command, server.args, root])).slice(0, 16),
      })
    }
  }
  return { definitions, problems: [] }
}

function baseName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
