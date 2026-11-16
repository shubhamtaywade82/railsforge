// Interoperability in the direction RailsForge serves: an MCP client in its own process starts RailsForge's standalone
// server over stdio and runs the protocol. The client (test/fixtures/mcp/interop-client.mjs) uses the official MCP SDK and
// imports nothing from RailsForge. Nothing here needs the VS Code extension host.
//
// The server bundle is built from the current source before the client runs, so the test never checks a stale build.
// The project is a small Rails fixture (test/fixtures/rails-app), read statically.
import { describe, it, expect, beforeAll } from 'vitest'
import { execFile, execFileSync } from 'child_process'
import { createRequire } from 'module'
import * as fs from 'fs'
import * as path from 'path'
import { promisify } from 'util'

const requireFrom = createRequire(__filename)
const ROOT = path.join(__dirname, '..')
const SERVER = path.join(ROOT, 'dist', 'mcp', 'server.js')
const CLIENT = path.join(__dirname, 'fixtures', 'mcp', 'interop-client.mjs')
const PROJECT = path.join(__dirname, 'fixtures', 'rails-app')
const execFileAsync = promisify(execFile)

interface CallReport {
  ok: boolean
  isError?: boolean
  text?: string | null
  code?: number | null
  message?: string
  structured?: Record<string, unknown> | null
  meta?: { railsforge?: { code?: string } } | null
}

interface Report {
  errors: string[]
  server: { name: string; version: string }
  capabilities: Record<string, unknown>
  tools: Array<{ name: string; inputSchema: { type?: string; properties?: Record<string, unknown>; required?: string[] } }>
  getSchemaOrder: CallReport
  listRoutesOrders: CallReport
  invalidArguments: CallReport
  unknownTool: CallReport
  healthRoute: CallReport
  servedAfterErrors: CallReport
  listPatterns: CallReport
  listSkills: CallReport
  untrustedRake: CallReport
  noIndex: CallReport
  afterTransportClosed: CallReport
  serverClosedAfterClose: boolean
  serverStderr: string
}

let report: Report

/** The text of a successful call, parsed. A failed call fails the assertion that uses this. */
function structured(call: CallReport): unknown {
  expect(call.ok).toBe(true)
  expect(call.isError).toBe(false)
  return JSON.parse(call.text ?? 'null')
}

beforeAll(async () => {
  // Build the bundle from the current source. A failed build fails the whole suite here, with the compiler's output.
  execFileSync(process.execPath, [requireFrom.resolve('webpack/bin/webpack.js'), '--mode', 'production'], {
    cwd: ROOT,
    stdio: 'pipe',
    timeout: 300_000,
  })
  const { stdout } = await execFileAsync(process.execPath, [CLIENT, SERVER, PROJECT], { timeout: 120_000 })
  report = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as Report
}, 420_000)

describe('an independent MCP client, in its own process, against RailsForge\'s standalone server', () => {
  it('initializes with the server, which identifies itself and advertises tools and resources', () => {
    expect(report.errors).toEqual([])
    expect(report.server).toMatchObject({ name: 'railsforge', version: '0.2.0' })
    expect(report.capabilities).toHaveProperty('tools')
    expect(report.capabilities).toHaveProperty('resources')
  })

  it('lists the tools, each with an object input schema the client can read', () => {
    const names = report.tools.map(tool => tool.name)
    expect(names).toEqual(expect.arrayContaining(['get_schema', 'list_routes']))
    for (const tool of report.tools) {
      expect(tool.inputSchema.type, `${tool.name} input schema type`).toBe('object')
    }
    const getSchema = report.tools.find(tool => tool.name === 'get_schema')!
    expect(getSchema.inputSchema.properties).toHaveProperty('model')
    const listRoutes = report.tools.find(tool => tool.name === 'list_routes')!
    expect(listRoutes.inputSchema.properties).toHaveProperty('filter')
  })

  it('get_schema returns the table columns of a model as structured JSON, from db/schema.rb', () => {
    const columns = structured(report.getSchemaOrder) as Array<{ name: string; type: string; nullable: boolean }>
    expect(Array.isArray(columns)).toBe(true)
    expect(columns.map(column => column.name)).toEqual(expect.arrayContaining(['customer_id', 'status', 'total_cents']))
    expect(columns.find(column => column.name === 'customer_id')).toMatchObject({ type: 'integer', nullable: false })
  })

  it('list_routes returns the matching routes as structured JSON, with verb, path, controller and action', () => {
    const routes = structured(report.listRoutesOrders) as Array<{ verb: string; uriPattern: string; controller: string; action: string }>
    expect(routes).toEqual(expect.arrayContaining([
      { verb: 'GET', uriPattern: '/orders', controller: 'orders', action: 'index' },
      { verb: 'GET', uriPattern: '/orders/:id', controller: 'orders', action: 'show' },
    ]))
  })

  it('a route whose target is in single quotes is listed too, and not silently dropped', () => {
    const routes = structured(report.healthRoute) as Array<{ uriPattern: string; controller: string; action: string }>
    expect(routes).toEqual([{ verb: 'GET', uriPattern: '/health', controller: 'health', action: 'show' }])
  })

  it('a call with invalid arguments is refused by the protocol with its reason, and the server keeps serving', () => {
    expect(report.invalidArguments.ok).toBe(true)
    expect(report.invalidArguments.isError).toBe(true)
    expect(report.invalidArguments.text).toContain('Invalid arguments for tool get_schema')
    expect(report.invalidArguments.text).toContain('expected string')

    const routes = structured(report.servedAfterErrors) as Array<{ uriPattern: string }>
    expect(routes.map(route => route.uriPattern)).toEqual(expect.arrayContaining(['/orders']))
  })

  it('a call to a tool that does not exist is refused, and names the tool', () => {
    expect(report.unknownTool.ok).toBe(true)
    expect(report.unknownTool.isError).toBe(true)
    expect(report.unknownTool.text).toContain('no_such_tool not found')
  })

  it('shuts down when the client closes it, with no protocol error on the client side', () => {
    expect(report.errors).toEqual([])
    expect(report.serverClosedAfterClose).toBe(true)
  })

  it('is built for plain Node, with no VS Code module in the server bundle, and its client imports nothing from RailsForge', () => {
    const bundle = fs.readFileSync(SERVER, 'utf8')
    expect(bundle).not.toMatch(/require\(["']vscode["']\)/)
    const client = fs.readFileSync(CLIENT, 'utf8')
    expect(client).not.toMatch(/from ['"]\.\.?\/(\.\.\/)*src\//)
  })
  it('list_patterns returns structured data that the SDK client validated against its declared output schema', () => {
    const call = report.listPatterns
    expect(call.ok).toBe(true)
    expect(call.isError).toBe(false)
    expect(call.structured).toMatchObject({ patterns: expect.arrayContaining([expect.objectContaining({ name: 'CreateOrderService', type: 'service' })]) })
  })

  it('the text and the structured value of a list are the same data', () => {
    const routes = JSON.parse(report.listRoutesOrders.text ?? 'null') as unknown
    expect(report.listRoutesOrders.structured).toEqual({ routes })
  })

  it('list_skills returns the count and the list, consistent with each other', () => {
    const call = report.listSkills
    expect(call.ok).toBe(true)
    expect(call.isError).toBe(false)
    const data = call.structured as { count: number; skills: unknown[]; source: string | null }
    expect(data.skills.length).toBe(data.count)
    expect(data.count).toBeGreaterThan(0)
  })

  it('project code refused in an untrusted workspace is an error with its code in _meta, and the server keeps serving', () => {
    expect(report.untrustedRake.isError).toBe(true)
    expect(report.untrustedRake.meta?.railsforge?.code).toBe('EXECUTION_DISABLED')
    expect(report.untrustedRake.structured ?? null).toBeNull()
    expect(report.servedAfterErrors.isError).toBe(false)
  })

  it('a tool whose index is not built is an error with INDEX_UNAVAILABLE, not a text answer', () => {
    expect(report.noIndex.isError).toBe(true)
    expect(report.noIndex.meta?.railsforge?.code).toBe('INDEX_UNAVAILABLE')
  })

  it('a call after the transport is closed fails as a transport failure, not as a tool result', () => {
    expect(report.afterTransportClosed.ok).toBe(false)
    expect(report.afterTransportClosed.message).toBeTruthy()
  })
})
