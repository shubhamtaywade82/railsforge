/**
 * DevDocsHoverProvider - Zero-latency, fully offline hover documentation, sourced from
 * a DevDocsFetcher-cached docset (see DevDocsOfflineIndex) rather than a network call.
 * Registered before ApiDockHoverProvider so DevDocs' official documentation renders
 * above APIDock's community note in the combined tooltip VS Code assembles from every
 * matching hover provider.
 *
 * Deliberately not scoped to a curated method list the way ApiDockHoverProvider is:
 * the whole point of bundling the real DevDocs data is comprehensive coverage, so this
 * looks up whatever word is under the cursor directly. In a `.rb` file that means
 * hovering an ordinary local variable named `save` or `each` will surface Ruby/Rails
 * docs for a same-named method — an accepted tradeoff (RailsForge has no type
 * inference to disambiguate) rather than a bug, matching how ApiDockHoverProvider and
 * GemLensProvider already behave for their own lookups.
 */

import * as vscode from 'vscode'
import { DevDocsOfflineIndex } from './DevDocsOfflineIndex'

export class DevDocsHoverProvider implements vscode.HoverProvider {
  constructor(
    /** Resolves the offline index for the project that owns the hovered document. */
    private indexFor: (uri: vscode.Uri) => DevDocsOfflineIndex,
    private isEnabled: () => boolean,
  ) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
    if (!this.isEnabled()) {return null}

    const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*[?!]?/)
    if (!range) {return null}

    const word = document.getText(range)
    const result = this.indexFor(document.uri).lookup(word)
    if (!result) {return null}

    const md = new vscode.MarkdownString()
    md.isTrusted = false
    md.appendMarkdown(`### DevDocs: \`${result.name}\`\n\n`)
    if (result.signature) {
      md.appendCodeblock(result.signature, 'ruby')
    }
    if (result.description) {
      md.appendMarkdown(`${result.description}\n\n`)
    }
    md.appendMarkdown(`[View on DevDocs](${result.url}) · *offline copy, ${result.slug}*`)

    return new vscode.Hover(md, range)
  }
}
