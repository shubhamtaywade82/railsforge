#!/usr/bin/env node
// Acceptance: Nexum's MCP v2 client, through its own McpToolAdapter and trust policy, against RailsForge's standalone server.
//
// It imports Nexum's compiled modules from a Nexum checkout and never modifies that checkout. It needs:
//   - a Nexum checkout with its dependencies installed and compiled:  npm ci --ignore-scripts && npx tsc -p tsconfig.json
//   - RailsForge's built server bundle (dist/mcp/server.js), which this script builds unless --skip-build is given.
//
//   node scripts/acceptance/nexum-mcp.mjs --nexum /path/to/nexum [--skip-build]
//
// Each check states the requirement it tests. A failed check is a finding about the integration, not a harness error.
// Exit 0: every check passed. Exit 1: at least one check failed (the failures are listed). Exit 2: blocked.
import { spawnSync, execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RF = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SERVER = path.join(RF, 'dist', 'mcp', 'server.js')
const ECHO = path.join(RF, 'test', 'fixtures', 'mcp', 'echo-server.mjs')
const FIXTURE = path.join(RF, 'test', 'fixtures', 'rails-app')

const args = process.argv.slice(2)
const nexumIndex = args.indexOf('--nexum')
const NEXUM = nexumIndex >= 0 ? path.resolve(args[nexumIndex + 1] ?? '') : process.env.NEXUM_DIR ? path.resolve(process.env.NEXUM_DIR) : ''
const skipBuild = args.includes('--skip-build')

if (!NEXUM || !fs.existsSync(path.join(NEXUM, 'dist', 'mcp', 'adapter', 'mcp-server-tools.js'))) {
  console.log(JSON.stringify({ status: 'blocked', reason: 'no compiled Nexum checkout: pass --nexum <dir> after npm ci --ignore-scripts and npx tsc -p tsconfig.json' }))
  process.exit(2)
}

if (!skipBuild) {
  const build = spawnSync(process.execPath, [path.join(RF, 'node_modules', 'webpack', 'bin', 'webpack.js'), '--mode', 'production'], { cwd: RF, encoding: 'utf8' })
  if (build.status !== 0) {
    console.log(JSON.stringify({ status: 'blocked', reason: 'the RailsForge server bundle did not build', detail: (build.stderr || build.stdout).slice(0, 400) }))
    process.exit(2)
  }
}

const { connectMcpServerTools } = await import(pathToFileURL(path.join(NEXUM, 'dist', 'mcp', 'adapter', 'mcp-server-tools.js')).href)
const { connectMcpServerV2 } = await import(pathToFileURL(path.join(NEXUM, 'dist', 'mcp', 'adapter', 'mcp-client-factory.js')).href)
const { McpTrustPolicy } = await import(pathToFileURL(path.join(NEXUM, 'dist', 'mcp', 'trust.js')).href)

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-nexum-'))
const project = path.join(work, 'rails-app')
fs.cpSync(FIXTURE, project, { recursive: true }) // RailsForge may write an audit trail into the project; keep the repository clean.
const sha = (dir) => {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

const checks = []
const record = (id, requirement, ok, evidence) => checks.push({ id, requirement, status: ok ? 'pass' : 'fail', evidence })
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const until = async (predicate, ms) => {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (predicate()) {return true}
    await sleep(100)
  }
  return predicate()
}
const exists = (dir, name) => fs.existsSync(path.join(dir, name))
const trustAsk = (name, extra = {}) => new McpTrustPolicy({ rules: [{ match: name, trust: 'ask', ...extra }], approver: () => true, defaultTrust: 'untrusted' })
const railsforgeEnv = { RAILSFORGE_WORKSPACE_ROOT: project }
const openConnections = []
const track = (connection) => {
  openConnections.push(connection)
  return connection
}

try {
  // Connection 1: the RailsForge server, approved by the policy, with every tool it declares.
  const rf = track(await connectMcpServerTools(process.execPath, [SERVER], { serverName: 'railsforge', trust: trustAsk('railsforge'), env: railsforgeEnv }))
  const byName = new Map(rf.tools.map(tool => [tool.name, tool]))

  // 1. Discovery: the declared tools and their input schemas reach Nexum.
  const expected = ['list_routes', 'get_schema', 'get_dependencies', 'list_rake_tasks']
  const schemasOk = expected.every(name => byName.get(name)?.parameters?.type === 'object')
  record('discovery', 'Nexum discovers RailsForge\'s declared tools, each with an object input schema', expected.every(name => byName.has(name)) && schemasOk, `${rf.tools.length} tools offered`)

  // 2. Structured result: list_routes returns its structured value, which Nexum passes through.
  const routes = await byName.get('list_routes').call({ filter: 'orders' })
  const structured = routes.structuredContent?.routes
  record('structured-result', 'a call to list_routes returns its structured result to the agent', Array.isArray(structured) && structured.length === 2 && !routes.isError, `routes: ${structured?.length ?? 'none'}`)

  // 3. Error semantics: an unbuilt index is a tool error, and the reason reaches the agent.
  const deps = await byName.get('get_dependencies').call({ name: 'Order' })
  record('error-code', 'INDEX_UNAVAILABLE is preserved as a tool error with its code', deps.isError === true && deps._meta?.railsforge?.code === 'INDEX_UNAVAILABLE', `_meta.railsforge.code=${deps._meta?.railsforge?.code ?? 'absent'}`)
  record('error-reason', 'the reason for the error reaches the agent in the error message', String(deps.message ?? '').includes('persistent index not found'), `message: ${String(deps.message ?? '').slice(0, 90)}`)

  // 4a. Refusal without approval: a server the policy does not approve must not start.
  const denialDir = path.join(work, 'denial')
  fs.mkdirSync(denialDir)
  process.chdir(denialDir)
  let refused = false
  try {
    track(await connectMcpServerTools(process.execPath, [ECHO, '--rf-run=denial'], { serverName: 'echo', trust: new McpTrustPolicy({ rules: [{ match: 'echo', trust: 'ask' }], defaultTrust: 'untrusted' }) }))
  } catch (err) {
    refused = /\[mcp-trust\]/.test(String(err.message))
  }
  record('refusal-connect', 'an unapproved server is refused with the trust reason', refused, refused ? 'refused by policy' : 'not refused')
  record('refusal-spawn', 'an unapproved server is not started (no process runs before the decision)', !exists(denialDir, 'started.log'), exists(denialDir, 'started.log') ? 'the process started before the trust decision' : 'no process started')

  // 4a-bis. Restricted exposure: an allow list offers exactly the tools named, and nothing else.
  const allowOnly = track(await connectMcpServerTools(process.execPath, [SERVER], { serverName: 'railsforge', trust: trustAsk('railsforge', { tools: { allow: ['list_routes'] } }), env: railsforgeEnv }))
  const offered = allowOnly.tools.map(tool => tool.name)
  record('tool-allow-list', 'an allow list offers only the tools it names', offered.length === 1 && offered[0] === 'list_routes', `offered: ${offered.join(', ') || 'none'}`)

  // 4b. Risk ceiling: with maxRisk "medium", no tool of this server is offered (every tool is high risk).
  const ceiling = track(await connectMcpServerTools(process.execPath, [SERVER], { serverName: 'railsforge', trust: trustAsk('railsforge', { maxRisk: 'medium' }), env: railsforgeEnv }))
  record('risk-ceiling', 'a risk ceiling denies tools above it', ceiling.tools.length === 0, `${ceiling.tools.length} tools offered`)

  // 4c. Project code needs more than the policy: RailsForge's own grant refuses the R2 tool when it is not given.
  const grantless = track(await connectMcpServerTools(process.execPath, [SERVER], {
    serverName: 'railsforge',
    trust: trustAsk('railsforge', { maxRisk: 'low', toolSecurity: { list_rake_tasks: { risk: 'low' } } }),
    env: railsforgeEnv,
  }))
  const rake = grantless.tools.find(tool => tool.name === 'list_rake_tasks')
  const rakeResult = rake ? await rake.call({}) : undefined
  record('project-code-refused', 'project code does not run without RailsForge\'s grant, and the refusal names its code', rakeResult?._meta?.railsforge?.code === 'EXECUTION_DISABLED', `code=${rakeResult?._meta?.railsforge?.code ?? 'no call'}`)

  // 5. Cancellation, on the echo fixture: RailsForge has no native tool that runs long enough to test it.
  const cancelDir = path.join(work, 'cancel')
  fs.mkdirSync(cancelDir)
  process.chdir(cancelDir)
  const runId = `cancel-${process.pid}`
  const echo = track(await connectMcpServerTools(process.execPath, [ECHO, `--rf-run=${runId}`], { serverName: 'echo', trust: trustAsk('echo') }))
  const slow = echo.tools.find(tool => tool.name === 'slow')
  const controller = new AbortController()
  const started = Date.now()
  const pending = slow.call({}, { signal: controller.signal })
  await until(() => exists(cancelDir, 'calls.log') && fs.readFileSync(path.join(cancelDir, 'calls.log'), 'utf8').includes('slow'), 10_000)
  controller.abort()
  const cancelled = await pending
  record('cancel-returns', 'an aborted call returns to the agent promptly, as cancelled', cancelled.error === 'McpCancelled' && Date.now() - started < 5_000, `error=${cancelled.error ?? 'none'} after ${Date.now() - started} ms`)
  const observed = await until(() => exists(cancelDir, 'cancelled.marker'), 3_000)
  record('cancel-reaches-server', 'the server observes the cancellation, so its work stops', observed, observed ? 'the server observed the cancellation' : 'the server never observed a cancellation: the call keeps running there')

  await echo.close()
  const gone = await until(() => spawnSync('pgrep', ['-f', `--rf-run=${runId}`]).status !== 0, 5_000)
  record('no-process-left', 'closing the connection leaves no server process behind', gone, gone ? 'no process left' : 'a server process is still running after close')

  // Informational: the adapter documents risk as inferred from MCP annotations. RailsForge declares no annotations, and the
  // code ignores them, so every tool is classed high unless the user overrides it.
  const lowered = rf.tools.filter(tool => tool.security.risk !== 'high').length
  record('info-risk-inference', 'INFORMATIONAL: Nexum classes read-only tools below high risk, from the server\'s declared hints', lowered > 0, `${lowered} of ${rf.tools.length} tools below high`)

  // Informational: whether the SDK's own signal option, used directly, reaches the server.
  const runInfo = `cancel-sdk-${process.pid}`
  const sdkDir = path.join(work, 'sdk')
  fs.mkdirSync(sdkDir)
  process.chdir(sdkDir)
  const direct = await connectMcpServerV2({ kind: 'stdio', command: process.execPath, args: [ECHO, `--rf-run=${runInfo}`] })
  const sdkController = new AbortController()
  const sdkCall = direct.client.callTool({ name: 'slow', arguments: {} }, { signal: sdkController.signal }).catch(err => ({ rejected: err.name ?? String(err) }))
  await until(() => exists(sdkDir, 'calls.log'), 10_000)
  sdkController.abort()
  await sdkCall
  const sdkObserved = await until(() => exists(sdkDir, 'cancelled.marker'), 3_000)
  await direct.close()
  record('info-sdk-signal', 'INFORMATIONAL: the SDK\'s own signal option reaches the server (the fix path, not a requirement)', sdkObserved, sdkObserved ? 'observed' : 'not observed')
} finally {
  for (const connection of openConnections) {
    await connection.close().catch(() => undefined)
  }
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

const failed = checks.filter(check => check.status === 'fail' && !check.id.startsWith('info-'))
console.log(JSON.stringify({
  status: failed.length === 0 ? 'passed' : 'failed',
  railsforge: { path: RF, commit: sha(RF) },
  nexum: { path: NEXUM, commit: sha(NEXUM) },
  checks,
  findings: failed.map(check => check.id),
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
