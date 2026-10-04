/**
 * RdbgConfig - builds a launch configuration for the Ruby `rdbg` debugger extension
 * (KoichiSasada.vscode-rdbg) from a resolved toolchain command, so tests are debugged through
 * VS Code's real debug UI (breakpoints, stepping, variables) instead of a terminal.
 */

export const RDBG_EXTENSION_ID = 'KoichiSasada.vscode-rdbg'

export interface RdbgLaunchConfig {
  type: 'rdbg'
  name: string
  request: 'launch'
  command: string
  script: string
  args: string[]
  askParameters: false
  cwd: string
}

/** Double-quotes a part containing whitespace; backslashes are escaped *before* quotes so `\"` can't be forged. */
function quoteIfNeeded(part: string): string {
  return /\s/.test(part) ? `"${part.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : part
}

/**
 * `command`/`args` is the resolved invocation (e.g. bundle exec rspec file:12). The final
 * argument is the debug "script" (the test target); everything before it forms the command.
 */
export function buildRdbgLaunchConfig(name: string, root: string, command: string, args: readonly string[]): RdbgLaunchConfig {
  const all = [command, ...args]
  const script = all[all.length - 1]
  const launcher = all.slice(0, -1).map(quoteIfNeeded).join(' ')
  return { type: 'rdbg', name, request: 'launch', command: launcher, script, args: [], askParameters: false, cwd: root }
}
