/**
 * ProjectTerminal - trust-checked wrappers for the three ways RailsForge can run project code through
 * VS Code UI: terminals, debug sessions (see Trust.ts). Anything that types into a terminal or starts a
 * debugger must go through here.
 */

import * as vscode from 'vscode'
import { assertTrusted } from './Trust'

export function createProjectTerminal(options: vscode.TerminalOptions | string): vscode.Terminal {
  assertTrusted('open a terminal')
  return typeof options === 'string' ? vscode.window.createTerminal(options) : vscode.window.createTerminal(options)
}

export function sendToTerminal(terminal: vscode.Terminal, text: string, shouldExecute?: boolean): void {
  assertTrusted('send a command to a terminal')
  terminal.sendText(text, shouldExecute)
}

export function startProjectDebugging(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): Thenable<boolean> {
  assertTrusted('start a debug session')
  return vscode.debug.startDebugging(folder, config)
}
