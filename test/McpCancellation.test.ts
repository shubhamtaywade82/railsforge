// Cancellation of a native tool that runs a process, end to end: an independent MCP client cancels `list_rake_tasks`
// while its process runs, through the built standalone server. The stand-in commands are supplied on the PATH by the
// client (test/fixtures/mcp/cancel-client.mjs). The client waits past the listing's 15 s timeout before it reports, so a
// process that was not stopped by the cancellation would have been killed and replaced by then.
import { describe, it, expect, beforeAll } from 'vitest'
import { execFile, execFileSync } from 'child_process'
import { createRequire } from 'module'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'

const requireFrom = createRequire(__filename)
const ROOT = path.join(__dirname, '..')
const SERVER = path.join(ROOT, 'dist', 'mcp', 'server.js')
const CLIENT = path.join(__dirname, 'fixtures', 'mcp', 'cancel-client.mjs')
const FIXTURE = path.join(__dirname, 'fixtures', 'rails-app')
const execFileAsync = promisify(execFile)

interface CancelReport {
  errors: string[]
  bundleStarted: boolean
  cancelOutcome: 'aborted' | 'completed' | string
  bundleStoppedAfterCancel: boolean
  leftoverProcessesShortly: number
  laterCandidateStarted: boolean
  leftoverProcesses: number
  servedAfterCancel: { isError: boolean; structured: { tasks?: Array<{ name: string }> } | null }
}

let report: CancelReport

beforeAll(async () => {
  execFileSync(process.execPath, [requireFrom.resolve('webpack/bin/webpack.js'), '--mode', 'production'], { cwd: ROOT, stdio: 'pipe', timeout: 300_000 })
  // A copy of the project, so any audit record the server writes stays out of the repository.
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-cancel-project-'))
  fs.cpSync(FIXTURE, project, { recursive: true })
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLIENT, SERVER, project], { timeout: 200_000 })
    report = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as CancelReport
  } finally {
    fs.rmSync(project, { recursive: true, force: true })
  }
}, 420_000)

describe('cancelling a native tool that runs a process, through the standalone server', () => {
  it('the client sees the cancelled call end, and the server started the process it was cancelled in', () => {
    expect(report.errors).toEqual([])
    expect(report.bundleStarted).toBe(true)
    expect(report.cancelOutcome).toBe('aborted')
  })

  it('the cancelled process stops at once, not at its timeout', () => {
    expect(report.bundleStoppedAfterCancel).toBe(true)
    expect(report.leftoverProcessesShortly).toBe(0)
  })

  it('a cancelled listing does not start the next candidate', () => {
    expect(report.laterCandidateStarted).toBe(false)
  })

  it('no process is left behind once the listing has been cancelled', () => {
    expect(report.leftoverProcesses).toBe(0)
  })

  it('the server still serves after a cancellation, and its next listing completes', () => {
    expect(report.servedAfterCancel.isError).toBe(false)
    expect(report.servedAfterCancel.structured?.tasks?.map(task => task.name)).toEqual(['db:migrate'])
  })
})
