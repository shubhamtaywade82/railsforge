/**
 * Parsers for test runner output: RSpec's `--format json` and Minitest's default text format.
 */

export interface TestFailure {
  message: string
  /** 1-based line inside the test file, when the backtrace/header points there. */
  line?: number
}

export interface ExampleResult {
  status: 'passed' | 'failed' | 'pending'
  /** 1-based line of the example's declaration. */
  line: number
  filePath: string
  fullDescription: string
  durationMs: number
  failure?: TestFailure
}

interface RspecJsonExample {
  full_description?: string
  status?: string
  file_path?: string
  line_number?: number
  run_time?: number
  exception?: { class?: string; message?: string; backtrace?: string[] }
}

/** RSpec can print warnings before the JSON document; find the document start. */
function extractJsonObject(stdout: string): string | undefined {
  const start = stdout.search(/\{\s*"version"/)
  if (start === -1) {return undefined}
  return stdout.slice(start)
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

/** First backtrace entry that points into `filePath`, as a 1-based line. */
export function lineInFile(backtrace: readonly string[] | undefined, filePath: string): number | undefined {
  const target = normalizePath(filePath)
  for (const entry of backtrace ?? []) {
    const m = /^(.+?):(\d+)(?::in .*)?$/.exec(entry)
    if (!m) {continue}
    const file = normalizePath(m[1])
    if (file === target || target.endsWith(`/${file}`) || file.endsWith(`/${target}`)) {return Number(m[2])}
  }
  return undefined
}

export function parseRspecJson(stdout: string): ExampleResult[] | undefined {
  const json = extractJsonObject(stdout)
  if (!json) {return undefined}
  let parsed: { examples?: RspecJsonExample[] }
  try {
    parsed = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed.examples)) {return undefined}

  return parsed.examples.flatMap((ex): ExampleResult[] => {
    if (typeof ex.line_number !== 'number' || typeof ex.file_path !== 'string') {return []}
    const status = ex.status === 'passed' ? 'passed' : ex.status === 'pending' ? 'pending' : 'failed'
    const result: ExampleResult = {
      status,
      line: ex.line_number,
      filePath: normalizePath(ex.file_path),
      fullDescription: ex.full_description ?? '',
      durationMs: Math.round((ex.run_time ?? 0) * 1000),
    }
    if (status === 'failed') {
      const message = [ex.exception?.class, ex.exception?.message].filter(Boolean).join(': ') || 'Example failed'
      result.failure = { message, line: lineInFile(ex.exception?.backtrace, ex.file_path) }
    }
    return [result]
  })
}

export interface MinitestFailure {
  testName: string
  filePath: string
  line: number
  message: string
  kind: 'Failure' | 'Error'
}

export interface MinitestSummary {
  runs: number
  assertions: number
  failures: number
  errors: number
  skips: number
}

/** Parses "Failure:\nClass#test_x [file:line]:\nmessage" blocks and the "N runs, ..." summary. */
export function parseMinitestOutput(output: string): { failures: MinitestFailure[]; summary?: MinitestSummary } {
  const failures: MinitestFailure[] = []
  const lines = output.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kind = /^\s*(Failure|Error):\s*$/.exec(lines[i])
    if (!kind) {continue}
    const header = /^(\S+#\S+)\s+\[(.+?):(\d+)\]:\s*$/.exec(lines[i + 1] ?? '')
    if (!header) {continue}
    const body: string[] = []
    for (let j = i + 2; j < lines.length && lines[j].trim() !== '' ; j++) {body.push(lines[j])}
    failures.push({
      kind: kind[1] as 'Failure' | 'Error',
      testName: header[1],
      filePath: normalizePath(header[2]),
      line: Number(header[3]),
      message: body.join('\n') || `${kind[1]} in ${header[1]}`,
    })
  }

  const s = /(\d+) runs?, (\d+) assertions?, (\d+) failures?, (\d+) errors?, (\d+) skips?/.exec(output)
  const summary = s
    ? { runs: Number(s[1]), assertions: Number(s[2]), failures: Number(s[3]), errors: Number(s[4]), skips: Number(s[5]) }
    : undefined
  return { failures, summary }
}
