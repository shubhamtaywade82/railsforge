/**
 * ProjectProcess - the only module (with RubySyntax.ts, which only parses, and nativeSupport.ts, which only
 * asks the OS for its libc version) allowed to start processes. Every launch is trust-checked first, so a
 * future call site cannot forget the Restricted Mode gate (a test fails if another file imports child_process).
 */

import { execFile, spawn, spawnSync } from 'child_process'
import { promisify } from 'util'
import { assertTrusted } from '../workspace/Trust'
import { ToolLaunch, currentLaunchEnv, resolveToolLaunch } from './WindowsLaunch'

const rawExecFile = promisify(execFile)

/** `execFile` as a promise. In an untrusted workspace it returns a promise rejected with UntrustedWorkspaceError (never a sync throw, so `.then`/`Promise.all` callers behave) without starting anything. */
export const execFileAsync: typeof rawExecFile = ((command: string, ...rest: unknown[]) => {
  try {
    assertTrusted(command)
  } catch (err) {
    return Promise.reject(err)
  }
  return (rawExecFile as (...a: unknown[]) => unknown)(command, ...rest)
}) as typeof rawExecFile

export interface ToolRunOptions {
  cwd?: string
  maxBuffer?: number
  timeout?: number
  signal?: AbortSignal
}

export interface ToolRunResult {
  stdout: string
  stderr: string
}

/**
 * Runs a project tool and resolves with its output. Tools that RubyGems installs as Windows batch shims (bundle, rake,
 * rubocop and the rest) are found through PATHEXT and run through cmd.exe. On Windows, cancelling or timing out such a
 * run stops the whole process tree: killing cmd.exe alone would leave the tool it started running. Everywhere else this
 * is `execFileAsync`, with the same options. Trust-checked, like every launch in this module.
 */
export function runProjectTool(command: string, args: readonly string[], options: ToolRunOptions = {}): Promise<ToolRunResult> {
  try {
    assertTrusted(command)
    const launch = resolveToolLaunch(command, args, currentLaunchEnv())
    if (launch.viaCmd) {return runToolLaunch(launch, options)}
    return rawExecFile(launch.file, launch.args, { cwd: options.cwd, maxBuffer: options.maxBuffer, timeout: options.timeout, signal: options.signal })
  } catch (err) {
    return Promise.reject(err)
  }
}

/**
 * Runs a resolved launch and resolves with its output. Exported so that the cancel and timeout paths can be exercised on
 * any host: `platform` decides only whether the process tree is stopped with taskkill, and the tests pass `'win32'` to
 * reach that branch on Linux as well.
 */
export function runToolLaunch(launch: ToolLaunch, options: ToolRunOptions, platform: NodeJS.Platform = process.platform): Promise<ToolRunResult> {
  const { signal } = options
  return new Promise<ToolRunResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    // The listener and the timer are both removed when the process ends, so neither outlives the call.
    let stoppedBy: 'abort' | 'timeout' | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = (reason: 'abort' | 'timeout'): void => {
      stoppedBy = reason
      // Tree first: once cmd.exe has exited, its children can no longer be found from it.
      if (child.pid !== undefined) {killProcessTree(child.pid, platform)}
      child.kill()
    }
    const onAbort = (): void => stop('abort')
    const child = execFile(
      launch.file,
      launch.args,
      { cwd: options.cwd, maxBuffer: options.maxBuffer, windowsHide: true, windowsVerbatimArguments: true },
      (err, stdout, stderr) => {
        if (timer !== undefined) {clearTimeout(timer)}
        signal?.removeEventListener('abort', onAbort)
        if (stoppedBy === 'abort') {reject(abortError())}
        else if (stoppedBy === 'timeout') {reject(Object.assign(new Error(`${launch.file} timed out after ${options.timeout} ms`), { code: 'ETIMEDOUT' }))}
        else if (err) {reject(err)}
        else {resolve({ stdout: String(stdout), stderr: String(stderr) })}
      },
    )
    if (options.timeout !== undefined) {timer = setTimeout(() => stop('timeout'), options.timeout)}
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Stops a process and everything it started. On Windows, `taskkill /T` follows the tree from the given pid. */
function killProcessTree(pid: number, platform: NodeJS.Platform): void {
  if (platform === 'win32') {
    // Exit status is ignored: the process may have ended already, which is what we wanted.
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  }
}

function abortError(): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
}

/** `spawn`, refused in untrusted workspaces (keeps spawn's stdio-dependent return types). */
export const spawnProject: typeof spawn = ((command: string, ...rest: unknown[]) => {
  assertTrusted(command)
  return (spawn as (...a: unknown[]) => unknown)(command, ...rest)
}) as typeof spawn
