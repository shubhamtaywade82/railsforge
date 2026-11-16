/**
 * How a project tool is started on this platform. Pure: it reads the PATH, PATHEXT and the files that the injected
 * `exists` reports, and starts nothing. ProjectProcess is the module that actually starts the process.
 *
 * On Windows, RubyGems installs commands such as `bundle` and `rake` as `.cmd` or `.bat` batch shims. Node cannot run a
 * batch file directly, and `execFile` does not search PATHEXT, so a bare `bundle` is not found at all. The launch is
 * therefore rewritten to go through cmd.exe, with the arguments passed verbatim. Elsewhere the command runs as it is.
 */

import * as path from 'path'

export interface ToolLaunch {
  file: string
  args: string[]
  /** True when the launch goes through cmd.exe, so the arguments must be passed verbatim. */
  viaCmd: boolean
}

export interface LaunchEnv {
  platform: NodeJS.Platform
  /** PATH, with entries separated by `;`, as on Windows. */
  pathValue: string
  /** PATHEXT, with entries separated by `;`, for example `.COM;.EXE;.BAT;.CMD`. */
  pathext: string
  /** The command interpreter that runs batch shims. */
  comSpec: string
  exists(file: string): boolean
}

const BATCH_EXTENSIONS = new Set(['.cmd', '.bat'])

/**
 * Characters that cmd.exe cannot carry inside a double-quoted argument. Every caller passes fixed arguments, so one of
 * these reaching a batch shim is a bug, and the launch is refused rather than quoted badly.
 */
const UNQUOTABLE_FOR_CMD = /["%\r\n]/

/** Resolves a tool to the file that will actually run, and the arguments to pass it. */
export function resolveToolLaunch(command: string, args: readonly string[], env: LaunchEnv): ToolLaunch {
  if (env.platform !== 'win32') {return { file: command, args: [...args], viaCmd: false }}

  const found = findOnWindows(command, env)
  // Not found here: the launch is left as it was, so the OS reports the missing command exactly as before.
  if (found === undefined) {return { file: command, args: [...args], viaCmd: false }}
  if (!BATCH_EXTENSIONS.has(path.win32.extname(found).toLowerCase())) {
    return { file: found, args: [...args], viaCmd: false }
  }

  const parts = [found, ...args]
  for (const part of parts) {
    if (UNQUOTABLE_FOR_CMD.test(part)) {
      throw new Error(`refusing to run ${found} through cmd.exe with the argument ${JSON.stringify(part)}: cmd.exe cannot quote it safely`)
    }
  }
  // After /c, cmd.exe removes one pair of quotes from the outside of the line. The quoted command is therefore wrapped in
  // one more pair, so that the path and each argument keep theirs.
  const quoted = parts.map(part => `"${part}"`).join(' ')
  return {
    file: env.comSpec,
    args: ['/d', '/s', '/c', `"${quoted}"`],
    viaCmd: true,
  }
}

/**
 * The first file that Windows would run for `command`: in each PATH directory, in turn, each PATHEXT extension in
 * order. A command that already names an extension is tried as it is. A command with a separator is a path, used as given.
 */
function findOnWindows(command: string, env: LaunchEnv): string | undefined {
  const extensions = env.pathext.split(';').filter(ext => ext.length > 0)
  const variants = (base: string): string[] => (path.win32.extname(base) !== '' ? [base] : extensions.map(ext => base + ext))

  if (/[\\/]/.test(command)) {return variants(command).find(file => env.exists(file))}

  // Windows separates PATH entries with ';' on every host, so the model does not use path.delimiter, which is ':' on POSIX.
  for (const dir of env.pathValue.split(';')) {
    if (dir.length === 0) {continue}
    for (const file of variants(path.win32.join(dir, command))) {
      if (env.exists(file)) {return file}
    }
  }
  return undefined
}
