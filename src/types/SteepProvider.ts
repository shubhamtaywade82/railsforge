/**
 * SteepProvider - Runs Steep (a Ruby static type checker driven by RBS signatures) and
 * surfaces its findings as VS Code diagnostics. Uses `--format=github`, verified against
 * a real Steep run before choosing it over the default `code` formatter: `code` wraps
 * each diagnostic across several lines with a boxed type-relation trace, which is hard
 * to parse reliably, while `--format=github` emits exactly one GitHub Actions
 * workflow-command line per diagnostic:
 *
 *   ::error file=lib/greeter.rb,line=7,endLine=7,col=18,endColumn=20::[Ruby::ArgumentTypeMismatch] message
 *
 * Same `execFile` + `bundle exec X` (fall back to bare `X`) pattern as
 * RuboCopProvider/BrakemanProvider — never throws, degrades to an empty result. Like
 * Brakeman (and unlike RuboCop), Steep type-checks the whole configured target at once,
 * not a single file, so this is a whole-workspace scan rather than a per-document lint.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { firstCandidate } from '../util/RubyCommand'

const execFileAsync = promisify(execFile)

export interface SteepDiagnostic {
  severity: 'error' | 'warning' | 'notice'
  file: string
  line: number
  endLine: number
  col: number
  endColumn: number
  message: string
}

const GITHUB_FORMAT_LINE = /^::(error|warning|notice)\s+file=([^,]+),line=(\d+),endLine=(\d+),col=(\d+),endColumn=(\d+)::(.*)$/

export function parseSteepGithubOutput(stdout: string): SteepDiagnostic[] {
  const diagnostics: SteepDiagnostic[] = []
  for (const line of stdout.split('\n')) {
    const match = GITHUB_FORMAT_LINE.exec(line)
    if (!match) {continue}
    const [, severity, file, lineNo, endLine, col, endColumn, rawMessage] = match
    diagnostics.push({
      severity: severity as SteepDiagnostic['severity'],
      file,
      line: parseInt(lineNo, 10),
      endLine: parseInt(endLine, 10),
      col: parseInt(col, 10),
      endColumn: parseInt(endColumn, 10),
      // Only the first line (the actual error message) is useful in a single-line
      // diagnostic — the rest is the boxed type-relation trace GitHub's workflow-command
      // escaping turns into embedded %0A rather than real newlines.
      message: decodeGithubWorkflowCommand(rawMessage).split('\n')[0],
    })
  }
  return diagnostics
}

/**
 * GitHub's workflow-command escaping only ever percent-encodes three characters, applied
 * in this order: `%`→`%25`, then `\r`→`%0D`, then `\n`→`%0A`. Reversing it has to undo
 * those in the opposite order, or a literal "%25" in a message would double-decode into
 * "%" instead of staying "%25" — `decodeURIComponent` is the wrong tool here since it
 * decodes far more sequences than GitHub's format actually uses (e.g. a message
 * containing a literal, unescaped "%" followed by two hex digits would silently corrupt
 * that text).
 */
function decodeGithubWorkflowCommand(value: string): string {
  return value.replace(/%0A/g, '\n').replace(/%0D/g, '\r').replace(/%25/g, '%')
}

export class SteepProvider {
  async runCheck(workspaceRoot: string): Promise<SteepDiagnostic[]> {
    return (await firstCandidate(workspaceRoot, 'steep', ['check', '--format=github'], (cmd, args) => this.tryRun(cmd, args, workspaceRoot))) ?? []
  }

  private async tryRun(command: string, args: string[], cwd: string): Promise<SteepDiagnostic[] | null> {
    try {
      const { stdout } = await execFileAsync(command, args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 15000 })
      return parseSteepGithubOutput(stdout)
    } catch (err: unknown) {
      // Steep exits non-zero when it finds type errors, even though stdout still holds valid output.
      const execErr = err as { stdout?: string }
      return execErr.stdout ? parseSteepGithubOutput(execErr.stdout) : null
    }
  }
}
