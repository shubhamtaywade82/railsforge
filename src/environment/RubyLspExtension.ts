/**
 * Shopify Ruby LSP VS Code extension — version checks and recovery helpers.
 * RailsForge does not host the language server; it complements shopify.ruby-lsp.
 */

import * as vscode from 'vscode'
import { compareVersions } from '../diagnostics/Diagnostics'

export const RUBY_LSP_EXTENSION_ID = 'Shopify.ruby-lsp'

/** Below this, restart storms and "Client got disposed" recovery bugs were common (e.g. 0.10.x). */
export const MIN_RUBY_LSP_EXTENSION_VERSION = '0.11.0'

export function getRubyLspExtensionVersion(): string | undefined {
  const ext = vscode.extensions.getExtension(RUBY_LSP_EXTENSION_ID)
  const version = (ext?.packageJSON as { version?: string } | undefined)?.version
  return version?.trim() || undefined
}

export function isRubyLspExtensionOutdated(version: string | undefined): boolean {
  if (!version) {return false}
  return compareVersions(version, MIN_RUBY_LSP_EXTENSION_VERSION) < 0
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
