/**
 * Shell-aware command construction for `Terminal.sendText` (which takes one command
 * string, not argv). Quoting differs per shell, so the target shell is detected from
 * the integrated terminal's shell path instead of assuming POSIX.
 */

import * as path from 'path'

export type ShellKind = 'posix' | 'powershell' | 'cmd'

/** Classifies a shell executable path (e.g. `C:\Windows\System32\cmd.exe`, `/bin/zsh`). */
export function shellKindFromPath(shellPath: string | undefined, platform: NodeJS.Platform = process.platform): ShellKind {
  if (shellPath) {
    const base = path.win32.basename(shellPath).toLowerCase().replace(/\.exe$/, '')
    if (base === 'pwsh' || base === 'powershell') {return 'powershell'}
    if (base === 'cmd') {return 'cmd'}
    return 'posix'
  }
  // No shell reported: Windows defaults to PowerShell in VS Code, everything else is POSIX.
  return platform === 'win32' ? 'powershell' : 'posix'
}

export function quoteArg(value: string, kind: ShellKind): string {
  switch (kind) {
    case 'posix':
      return `'${value.replace(/'/g, "'\\''")}'`
    case 'powershell':
      // Single-quoted PowerShell strings are literal; only ' needs doubling.
      return `'${value.replace(/'/g, "''")}'`
    case 'cmd':
      // cmd.exe: wrap in double quotes, double any embedded ".
      return `"${value.replace(/"/g, '""')}"`
  }
}

/** Joins a command and its already-separated arguments into one safely-quoted line. */
export function buildCommandLine(command: string, args: readonly string[], kind: ShellKind): string {
  return [command, ...args.map(a => quoteArg(a, kind))].join(' ')
}

/** True if `p` has a `dir` path segment, regardless of separator style. */
export function hasPathSegment(p: string, dir: string): boolean {
  return p.replace(/\\/g, '/').split('/').includes(dir)
}
