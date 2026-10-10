/**
 * RubyAnalyzersProvider - runs the optional analyzers (Reek, Flog, Flay, Debride, Standard)
 * over a project on demand and publishes their findings to the Problems panel. Same shape as
 * BrakemanProvider: execFile through the project toolchain, no shell, never throws.
 */

import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { execFileAsync } from '../util/ProjectProcess'
import { rubyCandidates } from '../util/RubyCommand'
import { AnalyzerFinding, AnalyzerId, FindingSeverity, analyzerCommand, parseAnalyzerOutput } from './AnalyzerParsers'


export type AnalyzerStatus = 'ok' | 'unavailable' | 'failed'
export interface AnalyzerRunResult {
  id: AnalyzerId
  status: AnalyzerStatus
  findings: AnalyzerFinding[]
  detail?: string
}

const NOT_INSTALLED = /command not found|could not find command|is not installed|cannot load such file|Could not find .* in locally installed gems|bundler: failed to load command/i

const SEVERITY: Record<FindingSeverity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
}

export class RubyAnalyzersProvider implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('railsforge-analyzers')

  /** Runs one analyzer; never throws. */
  async runAnalyzer(root: string, id: AnalyzerId, paths: readonly string[], flogThreshold: number, signal?: AbortSignal): Promise<AnalyzerRunResult> {
    const existing = paths.filter(p => fs.existsSync(path.join(root, p)))
    if (existing.length === 0) {return { id, status: 'ok', findings: [] }}

    const { tool, args } = analyzerCommand(id, existing)
    let lastDetail = ''
    for (const c of rubyCandidates(root, tool, args)) {
      try {
        const { stdout } = await execFileAsync(c.command, c.args, { cwd: root, maxBuffer: 50 * 1024 * 1024, timeout: 180_000, signal })
        return { id, status: 'ok', findings: parseAnalyzerOutput(id, stdout, { flogThreshold }) }
      } catch (err: unknown) {
        const e = err as { code?: string | number; stdout?: string; stderr?: string; message?: string }
        if (e.code === 'ENOENT') {continue}
        const stdout = e.stdout ?? ''
        const stderr = e.stderr ?? e.message ?? ''
        // Analyzers exit non-zero when they find something (reek 2, standard 1): that is a result.
        if (stdout.trim() !== '') {
          return { id, status: 'ok', findings: parseAnalyzerOutput(id, stdout, { flogThreshold }) }
        }
        lastDetail = stderr.trim()
        if (NOT_INSTALLED.test(stderr)) {continue}
        return { id, status: 'failed', findings: [], detail: lastDetail }
      }
    }
    return { id, status: 'unavailable', findings: [], detail: lastDetail || `${tool} is not installed (bundle add ${tool} --group development)` }
  }

  /** Replaces all published findings with those from `results`. */
  publish(root: string, results: readonly AnalyzerRunResult[]): number {
    this.collection.clear()
    const byFile = new Map<string, vscode.Diagnostic[]>()
    let total = 0
    for (const result of results) {
      for (const f of result.findings) {
        const abs = path.isAbsolute(f.file) ? f.file : path.join(root, f.file)
        const start = Math.max(0, f.line - 1)
        const end = Math.max(start, (f.endLine ?? f.line) - 1)
        const diagnostic = new vscode.Diagnostic(new vscode.Range(start, 0, end, Number.MAX_SAFE_INTEGER), f.message, SEVERITY[f.severity])
        diagnostic.source = `RailsForge/${f.analyzer}`
        if (f.code) {diagnostic.code = f.code}
        const list = byFile.get(abs) ?? []
        list.push(diagnostic)
        byFile.set(abs, list)
        total++
      }
    }
    for (const [file, diagnostics] of byFile) {this.collection.set(vscode.Uri.file(file), diagnostics)}
    return total
  }

  clear(): void {
    this.collection.clear()
  }

  dispose(): void {
    this.collection.dispose()
  }
}
