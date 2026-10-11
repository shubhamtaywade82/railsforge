/**
 * Shopify Ruby LSP VS Code extension — host-side helpers.
 * Locked `ruby-lsp` gem versions come from the project's Gemfile.lock (see diagnostics).
 */

import * as vscode from 'vscode'

export const RUBY_LSP_EXTENSION_ID = 'Shopify.ruby-lsp'

export function getRubyLspExtensionVersion(): string | undefined {
  const ext = vscode.extensions.getExtension(RUBY_LSP_EXTENSION_ID)
  const version = (ext?.packageJSON as { version?: string } | undefined)?.version
  return version?.trim() || undefined
}

export async function reloadWindowForRubyLspRecovery(): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    'Ruby LSP\'s editor client is disposed and cannot be restarted from the palette. Reload the window to recover language features.',
    { modal: true },
    'Reload Window',
  )
  if (choice === 'Reload Window') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow')
  }
}
