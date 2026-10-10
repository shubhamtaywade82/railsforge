#!/usr/bin/env node
/**
 * mutation - mutation-tests the correctness- and security-critical pure modules with Stryker.
 *
 * Each group mutates a few source files and, for every mutant, runs a fresh `vitest` process over only the tests
 * that exercise them (Stryker's command runner; its vitest runner does not activate mutants reliably under
 * Vitest 5). A mutant that no test notices "survives": the report lists it so a test can be added.
 *
 *   pnpm run mutation                 # every group
 *   pnpm run mutation -- trust        # one group (name or substring)
 *   pnpm run mutation -- --list
 *
 * Exit code is non-zero if any group falls under its `break` score.
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** `exclude` drops mutator classes that only produce noise for that file (message text, hand-tuned regexes whose behaviour is pinned by corpus tests).
 * `break` is the minimum mutation score (%) for the group; set below the measured score so it only ratchets up. */
export const GROUPS = [
  { name: 'workspace-path', mutate: ['src/util/WorkspacePath.ts'], tests: ['test/WorkspacePath.test.ts', 'test/ChatDiffApplier.test.ts'], break: 80 },
  { name: 'trust', mutate: ['src/workspace/Trust.ts', 'src/util/ProjectProcess.ts'], tests: ['test/Trust.test.ts', 'test/ProjectProcess.test.ts', 'test/RestrictedManifest.test.ts'], break: 90 },
  { name: 'safety-rules', mutate: ['src/skills/SafetyRules.ts'], tests: ['test/SafetyRules.test.ts', 'test/SkillRoutingCorpus.test.ts'], exclude: ['Regex'], break: 72 },
  { name: 'agent-loop', mutate: ['src/agent/AgentLoop.ts'], tests: ['test/AgentLoop.test.ts'], exclude: ['Regex'], break: 70 },
  { name: 'freshness', mutate: ['src/semantic/Freshness.ts'], tests: ['test/GraphFreshness.test.ts'], break: 70 },
  { name: 'diagnostics', mutate: ['src/diagnostics/Diagnostics.ts'], tests: ['test/Diagnostics.test.ts', 'test/DiagnosticsExact.test.ts'], exclude: ['StringLiteral'], break: 90 },
  { name: 'line-diff', mutate: ['src/patch/LineDiff.ts'], tests: ['test/AiFixDiff.test.ts'], break: 70 },
]

const args = process.argv.slice(2)
if (args.includes('--list')) { for (const g of GROUPS) {console.log(`${g.name}: ${g.mutate.join(', ')}`)} process.exit(0) }
const wanted = args.filter(a => !a.startsWith('-'))
const selected = GROUPS.filter(g => wanted.length === 0 || wanted.some(w => g.name.includes(w)))
if (selected.length === 0) { console.error(`no group matches ${wanted.join(', ')}`); process.exit(2) }

fs.mkdirSync(path.join(repo, 'reports', 'mutation'), { recursive: true })
const summary = []
let failed = false
for (const g of selected) {
  const command = `node ./node_modules/vitest/vitest.mjs run ${g.tests.join(' ')} --reporter=dot --coverage.enabled=false`
  console.log(`\n=== mutation: ${g.name} (${g.mutate.join(', ')}) ===`)
  const started = Date.now()
  const base = JSON.parse(fs.readFileSync(path.join(repo, 'stryker.config.json'), 'utf8'))
  const configPath = path.join(repo, 'reports', 'mutation', `${g.name}.stryker.json`)
  fs.writeFileSync(configPath, JSON.stringify({
    ...base,
    $schema: undefined,
    commandRunner: { command },
    mutate: g.mutate,
    mutator: { excludedMutations: g.exclude ?? [] },
    concurrency: Number(process.env.STRYKER_CONCURRENCY ?? '4'),
    thresholds: { ...base.thresholds, break: g.break },
    jsonReporter: { fileName: `reports/mutation/${g.name}.json` },
  }, null, 2))
  const res = spawnSync(process.execPath, [
    path.join(repo, 'node_modules', '@stryker-mutator', 'core', 'bin', 'stryker.js'), 'run', configPath,
  ], { cwd: repo, stdio: 'inherit' })
  const seconds = Math.round((Date.now() - started) / 1000)
  let score = null
  try {
    const report = JSON.parse(fs.readFileSync(path.join(repo, 'reports', 'mutation', `${g.name}.json`), 'utf8'))
    let killed = 0; let total = 0
    for (const file of Object.values(report.files)) {
      for (const m of file.mutants) {
        if (m.status === 'Ignored' || m.status === 'CompileError') {continue}
        total++
        if (m.status === 'Killed' || m.status === 'Timeout') {killed++}
      }
    }
    score = total ? Math.round((killed / total) * 1000) / 10 : null
  } catch { /* report missing: Stryker itself failed */ }
  const ok = res.status === 0
  failed ||= !ok
  summary.push({ group: g.name, score, break: g.break, ok, seconds })
}
console.log('\nMutation summary')
for (const s of summary) {console.log(`  ${s.ok ? 'PASS' : 'FAIL'}  ${s.group.padEnd(16)} score ${s.score ?? '?'}% (break ${s.break}%)  ${s.seconds}s`)}
process.exit(failed ? 1 : 0)
