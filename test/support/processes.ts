// Counts the processes whose command line mentions a directory, so a test can check that a cancelled tool left nothing
// running. Returns null when the count cannot be read, so a missing tool fails the check instead of passing it.
import { spawnSync } from 'child_process'

export function countProcessesMentioning(dir: string): number | null {
  if (process.platform === 'win32') {
    const quoted = dir.replace(/'/g, "''")
    // The script itself contains the directory, so the PowerShell process would match its own command line: $PID excludes it.
    const script = `@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('${quoted}') }).Count`
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true })
    if (result.error || result.status !== 0) {return null}
    const count = Number.parseInt(String(result.stdout).trim(), 10)
    return Number.isNaN(count) ? null : count
  }
  // pgrep exits 1 when nothing matches, which is a count of zero, not a failure.
  const result = spawnSync('pgrep', ['-f', dir], { encoding: 'utf8' })
  if (result.error || (result.status !== 0 && result.status !== 1)) {return null}
  return String(result.stdout).trim().split('\n').filter(Boolean).length
}
