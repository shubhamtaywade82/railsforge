/**
 * Resolves "the project this action is about". Never `workspaceFolders[0]`:
 * a file in folder #2 must use folder #2's schema, routes, Gemfile and .railsforge.
 */

import * as vscode from 'vscode'
import { resolveWorkspaceRoot } from './WorkspaceRoots'

export function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)
}

/** Root owning `uri`; falls back to the active editor's root, then the sole/first folder. */
export function workspaceRootFor(uri?: vscode.Uri): string | undefined {
  const roots = workspaceRoots()
  const fromUri = resolveWorkspaceRoot(uri?.fsPath, roots)
  if (fromUri) {return fromUri}
  return activeWorkspaceRoot()
}

export function activeWorkspaceRoot(): string | undefined {
  const roots = workspaceRoots()
  const fromEditor = resolveWorkspaceRoot(vscode.window.activeTextEditor?.document.uri.fsPath, roots)
  return fromEditor ?? roots[0]
}
