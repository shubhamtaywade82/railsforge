/**
 * TestOutcomeMapper - pure mapping from parsed runner output to per-test-item outcomes,
 * so the Test Explorer controller only has to apply them to `vscode.TestRun`.
 */

import { ExampleResult, MinitestFailure } from './TestResultParsers'

export interface LeafRef {
  id: string
  /** Display name as discovered (string for `test "x"`, method name for `def test_x`). */
  name: string
  /** 0-based declaration line. */
  line: number
}

export type Outcome =
  | { status: 'passed'; durationMs?: number }
  | { status: 'skipped' }
  | { status: 'failed'; message: string; line?: number; durationMs?: number }
  | { status: 'errored'; message: string }

export function mapRspecOutcomes(
  leaves: readonly LeafRef[],
  results: readonly ExampleResult[] | undefined,
  exitCode: number,
  rawOutput: string,
): Map<string, Outcome> {
  const out = new Map<string, Outcome>()
  if (!results) {
    for (const leaf of leaves) {out.set(leaf.id, { status: 'errored', message: rawOutput.trim() || 'RSpec produced no results (load error?)' })}
    return out
  }
  const byLine = new Map(results.map(r => [r.line - 1, r]))
  for (const leaf of leaves) {
    const r = byLine.get(leaf.line)
    if (!r) {
      out.set(leaf.id, exitCode === 0 ? { status: 'passed' } : { status: 'errored', message: 'No result was reported for this example (did it move or is it generated dynamically?)' })
    } else if (r.status === 'passed') {
      out.set(leaf.id, { status: 'passed', durationMs: r.durationMs })
    } else if (r.status === 'pending') {
      out.set(leaf.id, { status: 'skipped' })
    } else {
      out.set(leaf.id, { status: 'failed', message: r.failure?.message ?? 'Example failed', line: r.failure?.line, durationMs: r.durationMs })
    }
  }
  return out
}

/** Minitest method name for a discovered test (`test "a b"` -> `test_a_b`). */
export function minitestMethodName(name: string): string {
  return name.startsWith('test_') ? name : `test_${name.trim().replace(/\s+/g, '_')}`
}

export function mapMinitestOutcomes(
  leaves: readonly LeafRef[],
  failures: readonly MinitestFailure[],
  exitCode: number,
  rawOutput: string,
): Map<string, Outcome> {
  const out = new Map<string, Outcome>()
  if (exitCode !== 0 && failures.length === 0) {
    for (const leaf of leaves) {out.set(leaf.id, { status: 'errored', message: rawOutput.trim() || 'Test run failed before any test executed' })}
    return out
  }

  const byName = new Map<string, MinitestFailure>()
  for (const f of failures) {byName.set(f.testName.split('#').pop() ?? f.testName, f)}
  const sorted = [...leaves].sort((a, b) => a.line - b.line)

  const claimed = new Set<MinitestFailure>()
  const failureFor = (leaf: LeafRef): MinitestFailure | undefined => {
    const byMethod = byName.get(minitestMethodName(leaf.name))
    if (byMethod) {return byMethod}
    // Fallback: a failure whose reported line falls inside this test's body (nearest preceding declaration).
    return failures.find(f => !claimed.has(f) && sorted.filter(l => l.line <= f.line - 1).pop()?.id === leaf.id)
  }

  for (const leaf of leaves) {
    const f = failureFor(leaf)
    if (f) {
      claimed.add(f)
      out.set(leaf.id, { status: 'failed', message: f.message, line: f.line })
    } else {
      out.set(leaf.id, { status: 'passed' })
    }
  }
  return out
}
