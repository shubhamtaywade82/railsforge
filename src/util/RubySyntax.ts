/** Ruby syntax checking via `ruby -c` (parse only — nothing is executed). Pure Node (no vscode import). */

import { spawn } from 'child_process'

export type SyntaxCheck = { status: 'ok' } | { status: 'error'; message: string } | { status: 'unavailable' }

/** Three-way result so callers can tell "valid" from "could not check" (ruby not installed). */
export function checkRubySyntax(content: string, command = 'ruby', timeoutMs = 10_000): Promise<SyntaxCheck> {
  return new Promise(resolve => {
    let settled = false
    const done = (result: SyntaxCheck): void => {
      if (!settled) {settled = true; clearTimeout(timer); resolve(result)}
    }
    const child = spawn(command, ['-c'], { stdio: ['pipe', 'pipe', 'pipe'] })
    const timer = setTimeout(() => { child.kill(); done({ status: 'unavailable' }) }, timeoutMs)
    let err = ''
    child.stderr.on('data', d => { err += String(d) })
    child.on('error', () => done({ status: 'unavailable' }))
    child.on('close', code => done(code === 0 ? { status: 'ok' } : { status: 'error', message: err.trim() || 'unknown syntax error' }))
    child.stdin.on('error', () => { /* ruby exited before reading: close handler reports it */ })
    child.stdin.end(content)
  })
}

/**
 * Syntax error message for Ruby content, or null when it is valid.
 * Fails open (null) when ruby isn't installed, so a missing runtime never blocks fixes.
 */
export async function rubySyntaxError(content: string): Promise<string | null> {
  const result = await checkRubySyntax(content)
  return result.status === 'error' ? result.message : null
}
