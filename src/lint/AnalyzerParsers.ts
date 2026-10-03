/**
 * Parsers for the optional Ruby analyzers (Reek, Flog, Flay, Debride, Standard).
 * Formats verified against Reek 6.6, Flog 4.9, Flay 2.14, Debride 1.15, Standard 1.56.
 */

export type AnalyzerId = 'reek' | 'flog' | 'flay' | 'debride' | 'standard'
export type FindingSeverity = 'error' | 'warning' | 'info' | 'hint'

export interface AnalyzerFinding {
  analyzer: AnalyzerId
  /** Path exactly as the tool printed it (relative to the project root, or absolute). */
  file: string
  /** 1-based. */
  line: number
  endLine?: number
  message: string
  severity: FindingSeverity
  code?: string
}

export const ANALYZER_IDS: readonly AnalyzerId[] = ['reek', 'flog', 'flay', 'debride', 'standard']

/** Tool + args to run for each analyzer over `paths` (project-relative). */
export function analyzerCommand(id: AnalyzerId, paths: readonly string[]): { tool: string; args: string[] } {
  switch (id) {
    case 'reek': return { tool: 'reek', args: ['--format', 'json', ...paths] }
    case 'flog': return { tool: 'flog', args: ['-a', ...paths] }
    case 'flay': return { tool: 'flay', args: ['--mass', '25', ...paths] }
    case 'debride': return { tool: 'debride', args: [...paths] }
    case 'standard': return { tool: 'standardrb', args: ['--format', 'json', ...paths] }
  }
}

export function parseReek(stdout: string): AnalyzerFinding[] {
  let parsed: unknown
  try { parsed = JSON.parse(stdout) } catch { return [] }
  if (!Array.isArray(parsed)) {return []}
  return parsed.flatMap((w: { context?: string; lines?: number[]; message?: string; smell_type?: string; source?: string }): AnalyzerFinding[] => {
    if (typeof w.source !== 'string' || !Array.isArray(w.lines) || w.lines.length === 0) {return []}
    const lines = w.lines.filter((n): n is number => typeof n === 'number')
    return [{
      analyzer: 'reek',
      file: w.source,
      line: Math.min(...lines),
      endLine: Math.max(...lines),
      message: `${w.context ?? ''} ${w.message ?? ''}`.trim(),
      severity: 'warning',
      code: w.smell_type,
    }]
  })
}

/** Flog rows: `    17.7: Greeter#dup_a                    app/a.rb:12-14`. Methods at/above `threshold` are reported. */
export function parseFlog(stdout: string, threshold: number): AnalyzerFinding[] {
  const findings: AnalyzerFinding[] = []
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+(?:\.\d+)?):\s+(\S+)\s+(\S+\.rb):(\d+)(?:-(\d+))?\s*$/.exec(line)
    if (!m) {continue}
    const score = Number(m[1])
    if (score < threshold) {continue}
    findings.push({
      analyzer: 'flog',
      file: m[3],
      line: Number(m[4]),
      endLine: m[5] ? Number(m[5]) : undefined,
      message: `${m[2]} has a complexity (flog) score of ${score.toFixed(1)} (threshold ${threshold})`,
      severity: score >= threshold * 2 ? 'warning' : 'info',
      code: 'flog',
    })
  }
  return findings
}

/** Flay groups: `1) Similar code found in :defn (mass = 42)` followed by indented `path:line` locations. */
export function parseFlay(stdout: string): AnalyzerFinding[] {
  const findings: AnalyzerFinding[] = []
  const lines = stdout.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const head = /^\d+\)\s+(Identical|Similar) code found in :(\w+) \(mass\*?\s*=\s*(\d+)\)/.exec(lines[i])
    if (!head) {continue}
    const locations: Array<{ file: string; line: number }> = []
    for (let j = i + 1; j < lines.length; j++) {
      const loc = /^\s+(\S+\.rb):(\d+)\s*$/.exec(lines[j])
      if (!loc) {break}
      locations.push({ file: loc[1], line: Number(loc[2]) })
    }
    for (const loc of locations) {
      const others = locations.filter(o => o !== loc).map(o => `${o.file}:${o.line}`).join(', ')
      findings.push({
        analyzer: 'flay',
        file: loc.file,
        line: loc.line,
        message: `${head[1]} code (${head[2]}, mass ${head[3]}) also at ${others}`,
        severity: head[1] === 'Identical' ? 'warning' : 'info',
        code: head[1].toLowerCase(),
      })
    }
  }
  return findings
}

/** Debride: a `Class` heading line followed by `  method   path:start-end (n)` rows. */
export function parseDebride(stdout: string): AnalyzerFinding[] {
  const findings: AnalyzerFinding[] = []
  let owner = ''
  for (const line of stdout.split('\n')) {
    const row = /^\s+(\S+)\s+(\S+\.rb):(\d+)(?:-(\d+))?\s+\(\d+\)\s*$/.exec(line)
    if (row) {
      findings.push({
        analyzer: 'debride',
        file: row[2],
        line: Number(row[3]),
        endLine: row[4] ? Number(row[4]) : undefined,
        message: `${owner ? `${owner}#` : ''}${row[1]} might not be called (dead code?)`,
        severity: 'hint',
        code: 'unused-method',
      })
    } else if (/^\S/.test(line) && !/^(These methods|Total suspect)/.test(line) && line.trim() !== '') {
      owner = line.trim()
    }
  }
  return findings
}

const STANDARD_SEVERITY: Record<string, FindingSeverity> = {
  fatal: 'error', error: 'error', warning: 'warning', convention: 'info', refactor: 'info', info: 'info',
}

/** Standard emits RuboCop's JSON schema. */
export function parseStandard(stdout: string): AnalyzerFinding[] {
  let parsed: { files?: Array<{ path?: string; offenses?: Array<{ severity?: string; message?: string; cop_name?: string; location?: { start_line?: number; last_line?: number } }> }> }
  try { parsed = JSON.parse(stdout) } catch { return [] }
  return (parsed.files ?? []).flatMap(f => (f.offenses ?? []).flatMap((o): AnalyzerFinding[] => {
    if (!f.path || typeof o.location?.start_line !== 'number') {return []}
    return [{
      analyzer: 'standard',
      file: f.path,
      line: o.location.start_line,
      endLine: o.location.last_line,
      message: o.message ?? '',
      severity: STANDARD_SEVERITY[o.severity ?? ''] ?? 'warning',
      code: o.cop_name,
    }]
  }))
}

export function parseAnalyzerOutput(id: AnalyzerId, stdout: string, options: { flogThreshold: number }): AnalyzerFinding[] {
  switch (id) {
    case 'reek': return parseReek(stdout)
    case 'flog': return parseFlog(stdout, options.flogThreshold)
    case 'flay': return parseFlay(stdout)
    case 'debride': return parseDebride(stdout)
    case 'standard': return parseStandard(stdout)
  }
}
