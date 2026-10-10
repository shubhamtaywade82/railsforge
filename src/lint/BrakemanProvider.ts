/**
 * BrakemanProvider - Runs Brakeman security analysis on Rails projects
 */

import { execFileAsync } from '../util/ProjectProcess'
import { firstCandidate } from '../util/RubyCommand'


export interface BrakemanWarning {
  warning_type: string
  warning_code: number
  fingerprint: string
  message: string
  file: string
  line: number
  link: string
  confidence: 'High' | 'Medium' | 'Weak'
  user_input?: string
}

export interface BrakemanReport {
  warnings: BrakemanWarning[]
  errors: string[]
  scanDuration: number
}

export class BrakemanProvider {
  async runScan(workspaceRoot: string): Promise<BrakemanReport> {
    const report = await firstCandidate(workspaceRoot, 'brakeman', ['-f', 'json', '-q'], (cmd, args) => this.tryBrakeman(cmd, args, workspaceRoot))
    return report ?? {
      warnings: [],
      errors: ['Brakeman execution failed.'],
      scanDuration: 0,
    }
  }

  private async tryBrakeman(command: string, args: string[], cwd: string): Promise<BrakemanReport | null> {
    try {
      const { stdout } = await execFileAsync(command, args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 30000 })
      return this.parseReport(stdout)
    } catch (err: unknown) {
      const execErr = err as { stdout?: string }
      return execErr.stdout ? this.parseReport(execErr.stdout) : null
    }
  }

  private parseReport(stdout: string): BrakemanReport | null {
    try {
      const parsed = JSON.parse(stdout)
      return {
        warnings: parsed.warnings ?? [],
        errors: parsed.errors ?? [],
        scanDuration: parsed.scan_info?.duration ?? 0,
      }
    } catch {
      return null
    }
  }

  formatMarkdownReport(report: BrakemanReport): string {
    if (report.warnings.length === 0) {
      return '## RailsForge Security Audit (Brakeman)\n\n✓ **0 Security Vulnerabilities Found!** Clean bill of health.'
    }

    const lines: string[] = ['## RailsForge Security Audit (Brakeman)\n']
    lines.push(`Found **${report.warnings.length}** security warning(s):\n`)

    for (const w of report.warnings) {
      lines.push(`### [${w.confidence} Confidence] ${w.warning_type}`)
      lines.push(`- **Location**: \`${w.file}:${w.line}\``)
      lines.push(`- **Details**: ${w.message}`)
      if (w.user_input) {
        lines.push(`- **User Input**: \`${w.user_input}\``)
      }
      lines.push('')
    }

    return lines.join('\n')
  }
}
