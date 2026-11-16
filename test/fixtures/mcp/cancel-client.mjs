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

// `bundle exec rake -T` runs until stopped, writing a heartbeat. With the `quick` flag it exits at once, so the next
// candidate (bare `rake`) runs, and the listing can complete.
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
  report.leftoverProcessesShortly = spawnSync('pgrep', ['-f', fakeDir], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).length

  // A listing has a 15 s timeout, after which an unstopped bundle would be killed and the next candidate would run.
  // Wait past that point before deciding whether a later candidate started.
  await sleep(Math.max(0, 16_500 - (Date.now() - cancelledAt)))
  report.laterCandidateStarted = exists('rake-started')
  report.leftoverProcesses = spawnSync('pgrep', ['-f', fakeDir], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).length

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
