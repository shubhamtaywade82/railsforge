// An MCP client in its own process, for cancellation of a native tool that runs a process. It starts the standalone
// RailsForge server with the project-code grant, and a stand-in `bundle` (which runs until it is stopped) and `rake`
// (which records that it started) on the PATH. It cancels a listing while `bundle` runs, then reports what happened.
// Usage: node cancel-client.mjs <server bundle> <project root>
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'

const [serverBundle, projectRoot] = process.argv.slice(2)
const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-cancel-fake-'))
const exists = name => fs.existsSync(path.join(fakeDir, name))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async (predicate, ms) => {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (predicate()) {return true}
    await sleep(50)
  }
  return predicate()
}

// The number of processes whose command line mentions the fake directory, or null when it cannot be read. Windows has no
// pgrep, so it asks PowerShell's process list.
function countProcesses(dir) {
  if (process.platform === 'win32') {
    const script = `@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${dir.replace(/'/g, "''")}') }).Count`
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true })
    if (result.error || result.status !== 0) {return null}
    const count = Number.parseInt(String(result.stdout).trim(), 10)
    return Number.isNaN(count) ? null : count
  }
  const result = spawnSync('pgrep', ['-f', dir], { encoding: 'utf8' })
  if (result.error || (result.status !== 0 && result.status !== 1)) {return null}
  return String(result.stdout).trim().split('\n').filter(Boolean).length
}

// `bundle exec rake -T` runs until stopped, writing a heartbeat. With the `quick` flag it exits at once, so the next
// candidate (bare `rake`) runs, and the listing can complete.
if (process.platform === 'win32') {
  // Windows runs batch files and executables only. The stand-in bundle is a batch file that starts a node loop; cancelling
  // must stop both, and both carry the fake directory in their command lines.
  // The heartbeat path comes in as an argument, so no path is written into the generated script's source.
  fs.writeFileSync(path.join(fakeDir, 'loop.mjs'), [
    "import * as fs from 'node:fs'",
    'const heartbeat = process.argv[2]',
    'const beat = () => fs.writeFileSync(heartbeat, String(Date.now()))',
    'beat()',
    'setInterval(beat, 100)',
    '',
  ].join('\n'))
  fs.writeFileSync(path.join(fakeDir, 'bundle.cmd'), [
    '@echo off',
    `echo started > "${path.join(fakeDir, 'bundle-started')}"`,
    `if exist "${path.join(fakeDir, 'quick')}" exit /b 1`,
    `"${process.execPath}" "${path.join(fakeDir, 'loop.mjs')}" "${path.join(fakeDir, 'bundle-heartbeat')}"`,
    '',
  ].join('\r\n'))
  fs.writeFileSync(path.join(fakeDir, 'rake.cmd'), [
    '@echo off',
    `echo started >> "${path.join(fakeDir, 'rake-started')}"`,
    'echo rake db:migrate  # Migrate',
    '',
  ].join('\r\n'))
} else {
  fs.writeFileSync(path.join(fakeDir, 'bundle'), [
    '#!/bin/sh',
    `echo started > "${fakeDir}/bundle-started"`,
    `if [ -f "${fakeDir}/quick" ]; then exit 1; fi`,
    `while true; do date +%s%N > "${fakeDir}/bundle-heartbeat"; sleep 0.1; done`,
    '',
  ].join('\n'))
  fs.writeFileSync(path.join(fakeDir, 'rake'), [
    '#!/bin/sh',
    `echo started >> "${fakeDir}/rake-started"`,
    'echo "rake db:migrate  # Migrate"',
    '',
  ].join('\n'))
  fs.chmodSync(path.join(fakeDir, 'bundle'), 0o755)
  fs.chmodSync(path.join(fakeDir, 'rake'), 0o755)
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverBundle],
  cwd: projectRoot,
  env: {
    ...getDefaultEnvironment(),
    RAILSFORGE_WORKSPACE_ROOT: projectRoot,
    RAILSFORGE_MCP_EXECUTION: 'project-code',
    PATH: `${fakeDir}${path.delimiter}${process.env.PATH ?? ''}`,
    FAKE_RAKE_DIR: fakeDir,
  },
  stderr: 'pipe',
})
const client = new Client({ name: 'cancel-check', version: '1.0.0' })
const report = { errors: [] }

try {
  await client.connect(transport)

  // 1. Cancel a listing while the bundle candidate is running.
  const controller = new AbortController()
  let cancelledAt = 0
  const listing = client.callTool({ name: 'list_rake_tasks', arguments: {} }, undefined, { signal: controller.signal })
    .then(() => 'completed', err => (err?.name === 'AbortError' || /abort/i.test(String(err?.message)) ? 'aborted' : `failed: ${err?.message}`))
  report.bundleStarted = await until(() => exists('bundle-started'), 10_000)
  cancelledAt = Date.now()
  controller.abort()
  report.cancelOutcome = await listing

  // 2. The bundle stops (its heartbeat stops changing), and no later candidate starts.
  const beat = () => (exists('bundle-heartbeat') ? fs.readFileSync(path.join(fakeDir, 'bundle-heartbeat'), 'utf8') : '')
  await sleep(500)
  const first = beat()
  await sleep(800)
  report.bundleStoppedAfterCancel = beat() === first
  report.leftoverProcessesShortly = countProcesses(fakeDir)

  // A listing has a 15 s timeout, after which an unstopped bundle would be killed and the next candidate would run.
  // Wait past that point before deciding whether a later candidate started.
  await sleep(Math.max(0, 16_500 - (Date.now() - cancelledAt)))
  report.laterCandidateStarted = exists('rake-started')
  report.leftoverProcesses = countProcesses(fakeDir)

  // 3. The server still serves: a listing without cancellation completes with its tasks.
  fs.writeFileSync(path.join(fakeDir, 'quick'), '1')
  const again = await client.callTool({ name: 'list_rake_tasks', arguments: {} })
  report.servedAfterCancel = { isError: again.isError === true, structured: again.structuredContent ?? null }
} catch (err) {
  report.errors.push(String(err?.stack ?? err))
} finally {
  try { await client.close() } catch { /* the transport may already be closed */ }
  spawnSync('pkill', ['-f', fakeDir])
  process.stdout.write(`${JSON.stringify(report)}\n`)
  fs.rmSync(fakeDir, { recursive: true, force: true })
}
