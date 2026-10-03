/**
 * ViewPartialDefinitionProvider - Ctrl+Click / Cmd+Click navigation from a
 * `render "shared/navbar"` / `render partial: "users/card"` call straight to the
 * partial file it resolves to.
 */

import * as vscode from 'vscode'
import { activeWorkspaceRoot } from '../workspace/activeRoot'
import { ViewPartialResolver, extractRenderPathAtPosition } from './ViewPartialResolver'

export class ViewPartialDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private resolver: ViewPartialResolver) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Definition> {
    const workspaceRoot = activeWorkspaceRoot()
    if (!workspaceRoot) {return null}

    const line = document.lineAt(position.line).text
    const renderPath = extractRenderPathAtPosition(line, position.character)
    if (!renderPath) {return null}

    const resolved = this.resolver.resolvePartialPath(renderPath, document.uri.fsPath, workspaceRoot)
    if (!resolved) {return null}

    return new vscode.Location(vscode.Uri.file(resolved), new vscode.Position(0, 0))
  }
}
