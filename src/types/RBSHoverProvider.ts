/**
 * RBSHoverProvider - Shows a matched .rbs method's type signature in the hover tooltip
 * for the corresponding Ruby method, when the project has RBS signature files (see
 * RBSIndex). Only active when RBSIndex actually found something to index — a project
 * with no sig/ directory pays zero cost for this provider.
 */

import * as vscode from 'vscode'
import { RBSIndex } from './RBSIndex'

export class RBSHoverProvider implements vscode.HoverProvider {
  /** Resolves the index for the project that owns the hovered document (multi-root safe). */
  constructor(private indexFor: (uri: vscode.Uri) => RBSIndex) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
    const index = this.indexFor(document.uri)
    if (index.isEmpty) {return null}

    const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*[?!]?/)
    if (!range) {return null}

    const word = document.getText(range)
    const matches = index.lookup(word)
    if (matches.length === 0) {return null}

    const md = new vscode.MarkdownString()
    md.isTrusted = false
    md.appendMarkdown('### RBS Signature\n\n')
    for (const match of matches.slice(0, 5)) {
      const prefix = match.isSelf ? `${match.className}.` : `${match.className}#`
      md.appendCodeblock(`${prefix}${match.methodName}: ${match.signature}`, 'rbs')
    }
    if (matches.length > 5) {
      md.appendMarkdown(`\n_...and ${matches.length - 5} more._`)
    }

    return new vscode.Hover(md, range)
  }
}
