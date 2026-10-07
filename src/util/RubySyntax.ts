/** Ruby syntax checking via `ruby -c`. Pure Node (no vscode import). */

import { spawn } from 'child_process'

/**
 * Runs `ruby -c` on Ruby content, returning the syntax error message on failure.
 * Fails open (null) when ruby isn't installed, so a missing runtime never blocks fixes.
 */
export function rubySyntaxError(content: string): Promise<string | null> {
  return new Promise(resolve => {
    const child = spawn('ruby', ['-c'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let err = ''
    child.stderr.on('data', d => { err += String(d) })
    child.on('error', () => resolve(null))
    child.on('close', code => resolve(code === 0 ? null : err.trim() || 'unknown syntax error'))
    child.stdin.end(content)
  })
}
