/**
 * RBSDefinitionProvider - Cmd+Click / Ctrl+Click on a `def method_name` line jumps to
 * that method's `.rbs` signature (RBS "signature navigation"). Only fires on the
 * method-name token of an actual `def` line — not every reference to that identifier —
 * so it doesn't compete with Ruby LSP's own go-to-definition for ordinary call sites.
 *
 * Finding the enclosing class/module is a lightweight indentation heuristic (nearest
 * preceding `class`/`module` line with strictly less indentation than the `def`), not a
 * full parse — matches the regex-based pragmatism the rest of this codebase's
 * indexers/providers already use for similar lookups.
 */

import * as vscode from 'vscode'
import { RBSIndex } from './RBSIndex'

const DEF_LINE = /^(\s*)def\s+(self\.)?([A-Za-z_]\w*[?!]?)/

export class RBSDefinitionProvider implements vscode.DefinitionProvider {
  /** Resolves the index for the project that owns the document (multi-root safe). */
  constructor(private indexFor: (uri: vscode.Uri) => RBSIndex) {}

  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Definition> {
    const index = this.indexFor(document.uri)
    if (index.isEmpty) {return null}

    const line = document.lineAt(position.line).text
    const match = DEF_LINE.exec(line)
    if (!match) {return null}

    const [, indent, selfPrefix, methodName] = match
    const nameStart = line.indexOf(methodName, indent.length + 3)
    if (position.character < nameStart || position.character > nameStart + methodName.length) {return null}

    const precedingLines: string[] = []
    for (let i = 0; i < position.line; i++) {
      precedingLines.push(document.lineAt(i).text)
    }
    const className = findEnclosingClass(precedingLines, indent.length)
    if (!className) {return null}

    const rbsMethod = index.lookupExact(className, methodName, Boolean(selfPrefix))
    if (!rbsMethod) {return null}

    return new vscode.Location(vscode.Uri.file(rbsMethod.filePath), new vscode.Position(rbsMethod.line, 0))
  }
}

/** Scans `precedingLines` (everything above the `def`) backward for the nearest `class`/`module` line indented less than the `def` itself — the def's immediate enclosing scope in conventionally-indented Ruby. */
export function findEnclosingClass(precedingLines: string[], defIndent: number): string | null {
  for (let i = precedingLines.length - 1; i >= 0; i--) {
    const text = precedingLines[i]
    if (!text.trim()) {continue}
    const indent = text.length - text.trimStart().length
    if (indent >= defIndent) {continue}
    const match = /^\s*(?:class|module)\s+([\w:]+)/.exec(text)
    if (match) {return match[1]}
  }
  return null
}
