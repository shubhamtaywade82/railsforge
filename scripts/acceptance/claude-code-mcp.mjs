#!/usr/bin/env node
// Acceptance: an installed, logged-in Claude Code discovers and calls RailsForge's standalone MCP server.
//
// This is a manual acceptance run, not part of the unit suite. It needs the Claude Code CLI on PATH, signed in, and a
// model call per session. It registers the server in user scope under the name "railsforge", runs two sessions, and
// removes the registration in every case. If a "railsforge" server already exists, it stops rather than replace it.
//
//   node scripts/acceptance/claude-code-mcp.mjs [--skip-build]
//
// Exit 0: every check passed. Exit 1: a check failed, with the reason. Exit 2: Claude Code is not available (blocked).
import { spawnSync } from 'node:child_process'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SERVER = path.join(ROOT, 'dist', 'mcp', 'server.js')
const PROJECT = path.join(ROOT, 'test', 'fixtures', 'rails-app')
const NAME = 'railsforge'
const TOOL_LIST = `mcp__${NAME}__list_routes`
const TOOL_DEPS = `mcp__${NAME}__get_dependencies`
const TOOL_RAKE = `mcp__${NAME}__list_rake_tasks`

const skipBuild = process.argv.includes('--skip-build')
const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok, detail })

function claude(args, input) {
  return spawnSync('claude', args, { encoding: 'utf8', input: input ?? '', timeout: 240_000, maxBuffer: 64 * 1024 * 1024 })
}

if (!skipBuild) {
  const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'webpack', 'bin', 'webpack.js'), '--mode', 'production'], { cwd: ROOT, encoding: 'utf8' })
  if (build.status !== 0) {
    console.error(`The server bundle did not build:\n${build.stderr || build.stdout}`)
    process.exit(1)
  }
}

const version = claude(['--version'])
if (version.error || version.status !== 0) {
  console.log(JSON.stringify({ status: 'blocked', reason: 'the Claude Code CLI is not available on PATH' }))
  process.exit(2)
}

const existing = claude(['mcp', 'get', NAME])
if (existing.status === 0) {
  console.log(JSON.stringify({ status: 'refused', reason: `an MCP server named "${NAME}" already exists; remove it first, so this run does not replace it` }))
  process.exit(1)
}

/** Parses a stream-json transcript into its tool calls and their results. */
function transcript(stdout) {
  const events = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line))
  const calls = []
  const results = new Map()
  const texts = []
  for (const event of events) {
    const content = Array.isArray(event.message?.content) ? event.message.content : []
    for (const block of content) {
      if (block.type === 'tool_use') {calls.push({ id: block.id, name: block.name, input: block.input })}
      if (block.type === 'tool_result') {
        const text = typeof block.content === 'string' ? block.content : (block.content ?? []).map(part => part.text ?? '').join('')
        results.set(block.tool_use_id, { isError: block.is_error === true, text })
      }
      if (block.type === 'text' && event.type === 'assistant') {texts.push(block.text)}
    }
  }
  const final = events.findLast(event => event.type === 'result')
  return { calls, results, answer: texts.join('\n'), denials: final?.permission_denials ?? [] }
}

function session(prompt, tools) {
  const run = claude(['-p', prompt, '--allowedTools', [...tools, 'ToolSearch'].join(','), '--output-format', 'stream-json', '--verbose'])
  if (run.status !== 0) {throw new Error(`claude -p exited ${run.status}: ${(run.stderr || '').slice(0, 300)}`)}
  return transcript(run.stdout)
}

const add = claude(['mcp', 'add', '--scope', 'user', NAME, '-e', `RAILSFORGE_WORKSPACE_ROOT=${PROJECT}`, '--', process.execPath, SERVER])
if (add.status !== 0) {
  console.log(JSON.stringify({ status: 'failed', reason: `could not register the server: ${add.stderr || add.stdout}` }))
  process.exit(1)
}

try {
  const listed = claude(['mcp', 'get', NAME])
  check('Claude Code connects to the server', listed.status === 0 && /Connected/.test(listed.stdout), listed.stdout.split('\n').find(line => /Status|Connected/.test(line)) ?? '')

  const routes = session("Call the railsforge list_routes tool with filter 'orders'. Reply with the uriPattern of each route it returns, one per line, and nothing else.", [TOOL_LIST])
  const listCall = routes.calls.find(call => call.name === TOOL_LIST)
  check('the session discovers and calls list_routes', Boolean(listCall), listCall ? JSON.stringify(listCall.input) : 'no call')
  const listResult = listCall ? routes.results.get(listCall.id) : undefined
  check('list_routes succeeds and returns the fixture routes', Boolean(listResult && !listResult.isError && listResult.text.includes('"uriPattern":"/orders"')))
  check('the answer is built from the tool result', routes.answer.includes('/orders') && routes.answer.includes('/orders/:id'))
  check('no permission was denied', routes.denials.length === 0, JSON.stringify(routes.denials))

  const failing = session("Call the railsforge get_dependencies tool with name 'Order', then the railsforge list_rake_tasks tool. For each, reply with its full error text if it failed.", [TOOL_DEPS, TOOL_RAKE])
  const depsCall = failing.calls.find(call => call.name === TOOL_DEPS)
  const depsResult = depsCall ? failing.results.get(depsCall.id) : undefined
  check('an unbuilt index is reported as an error, with its explanation', Boolean(depsResult?.isError && depsResult.text.includes('persistent index not found')))
  const rakeCall = failing.calls.find(call => call.name === TOOL_RAKE)
  const rakeResult = rakeCall ? failing.results.get(rakeCall.id) : undefined
  check('project code in an untrusted workspace is refused, with the grant it needs', Boolean(rakeResult?.isError && rakeResult.text.includes('explicit grant')))
} catch (error) {
  checks.push({ name: 'the sessions ran', ok: false, detail: String(error.message ?? error) })
} finally {
  const removed = claude(['mcp', 'remove', NAME, '--scope', 'user'])
  check('the registration was removed', removed.status === 0)
}

const failed = checks.filter(entry => !entry.ok)
console.log(JSON.stringify({ status: failed.length === 0 ? 'passed' : 'failed', checks }, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
