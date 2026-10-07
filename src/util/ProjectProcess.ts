/**
 * ProjectProcess - the only module (with RubySyntax.ts, which only parses, and nativeSupport.ts, which only
 * asks the OS for its libc version) allowed to start processes. Every launch is trust-checked first, so a
 * future call site cannot forget the Restricted Mode gate (a test fails if another file imports child_process).
 */

import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { assertTrusted } from '../workspace/Trust'

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

/** `spawn`, refused in untrusted workspaces (keeps spawn's stdio-dependent return types). */
export const spawnProject: typeof spawn = ((command: string, ...rest: unknown[]) => {
  assertTrusted(command)
  return (spawn as (...a: unknown[]) => unknown)(command, ...rest)
}) as typeof spawn
