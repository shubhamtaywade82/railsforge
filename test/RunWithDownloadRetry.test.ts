import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const WRAPPER = path.resolve(__dirname, '..', 'scripts', 'run-with-download-retry.mjs')

// Stands in for the host-test command. Every call is counted in calls.txt, next to the fixture.
const FIXTURE = `
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const counter = path.join(dir, 'calls.txt')
const calls = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0
fs.writeFileSync(counter, String(calls + 1))

const mode = process.argv[2]
const downloadTimeout = 'Error: @vscode/test-electron request timeout out after 15000ms'
if (mode === 'pass') { console.log('3 passing'); process.exit(0) }
if (mode === 'test-failure') { console.log('1 failing'); process.exit(1) }
if (mode === 'timeout-then-pass') {
  if (calls === 0) { console.error(downloadTimeout); process.exit(1) }
  console.log('3 passing'); process.exit(0)
}
console.error(downloadTimeout)
process.exit(1)
`

const created: string[] = []

afterEach(() => {
  for (const dir of created.splice(0)) {fs.rmSync(dir, { recursive: true, force: true })}
})

function runWrapper(mode: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-retry-'))
  created.push(dir)
  const fixture = path.join(dir, 'fixture.mjs')
  fs.writeFileSync(fixture, FIXTURE)
  const result = spawnSync(process.execPath, [WRAPPER, 'node', fixture, mode], { encoding: 'utf8' })
  const calls = Number(fs.readFileSync(path.join(dir, 'calls.txt'), 'utf8'))
  return { status: result.status, stdout: result.stdout, calls }
}

describe('run-with-download-retry', () => {
  it('returns a passing run after one call', () => {
    const run = runWrapper('pass')
    expect(run.status).toBe(0)
    expect(run.calls).toBe(1)
  })

  it('runs again when the VS Code download times out, and passes on that run', () => {
    const run = runWrapper('timeout-then-pass')
    expect(run.status).toBe(0)
    expect(run.calls).toBe(2)
    expect(run.stdout).toContain('Running the command once more')
  })

  it('never retries a failing test', () => {
    const run = runWrapper('test-failure')
    expect(run.status).toBe(1)
    expect(run.calls).toBe(1)
  })

  it('gives up after one retry when the download keeps timing out', () => {
    const run = runWrapper('always-timeout')
    expect(run.status).toBe(1)
    expect(run.calls).toBe(2)
  })
})
