/**
 * RubyCommand - the single place that turns "run <tool> in <project>" into concrete
 * commands, using the real filesystem/PATH and the `railsForge.ruby.versionManager` setting.
 * Callers get ordered candidates (binstub / bundle exec / bare, manager-wrapped) and try them in turn.
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  ResolvedCommand,
  ToolchainEnv,
  VersionManager,
  VersionManagerSetting,
  detectVersionManager,
  rubyCommandCandidates,
} from '../environment/RubyToolchain'
import { buildCommandLine, ShellKind } from './ShellCommand'

const onPathCache = new Map<string, boolean>()

function isOnPath(command: string): boolean {
  const cached = onPathCache.get(command)
  if (cached !== undefined) {return cached}
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  const dirs = (process.env.PATH ?? '').split(path.delimiter)
  // Version-manager installs that GUI-launched hosts frequently miss on PATH.
  const home = process.env.HOME ?? ''
  if (home) {dirs.push(path.join(home, '.rbenv', 'bin'), path.join(home, '.local', 'bin'), path.join(home, '.asdf', 'bin'), path.join(home, '.rvm', 'bin'))}
  dirs.push('/usr/local/bin', '/opt/homebrew/bin')
  const found = dirs.some(dir => dir && exts.some(ext => fs.existsSync(path.join(dir, command + ext))))
  onPathCache.set(command, found)
  return found
}

export const realToolchainEnv: ToolchainEnv = {
  exists: p => fs.existsSync(p),
  readFile: p => {
    try { return fs.readFileSync(p, 'utf8') } catch { return undefined }
  },
  onPath: isOnPath,
  platform: process.platform,
}

/**
 * Where the `railsForge.ruby.versionManager` setting comes from. This module is also bundled into the
 * standalone MCP server (no `vscode`), so the extension injects the setting instead of importing it.
 */
let versionManagerSetting: () => VersionManagerSetting = () => 'auto'

export function setVersionManagerSettingProvider(provider: () => VersionManagerSetting): void {
  versionManagerSetting = provider
}

export function projectVersionManager(root: string): VersionManager {
  return detectVersionManager(root, realToolchainEnv, versionManagerSetting())
}

/** Ordered commands to try for `tool` in `root` (preferred first). */
export function rubyCandidates(root: string, tool: string, args: readonly string[]): ResolvedCommand[] {
  return rubyCommandCandidates(root, tool, args, realToolchainEnv, { manager: projectVersionManager(root) })
}

/** One shell line (for Terminal.sendText) running the preferred candidate. */
export function rubyTerminalCommand(root: string, tool: string, args: readonly string[], kind: ShellKind): string {
  const [first] = rubyCandidates(root, tool, args)
  return buildCommandLine(first.command, first.args, kind)
}

/**
 * Runs `attempt` against each candidate in order and returns the first non-null result,
 * mirroring the previous "bundle exec X, then bare X" behaviour.
 */
export async function firstCandidate<T>(
  root: string,
  tool: string,
  args: readonly string[],
  attempt: (command: string, args: string[]) => Promise<T | null>,
): Promise<T | null> {
  for (const c of rubyCandidates(root, tool, args)) {
    const result = await attempt(c.command, c.args)
    if (result !== null) {return result}
  }
  return null
}
