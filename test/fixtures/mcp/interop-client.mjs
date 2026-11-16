// An MCP client in its own process. It uses the official MCP SDK client and nothing from RailsForge: it starts the
// standalone RailsForge server over stdio, runs the protocol steps, prints one JSON report on stdout, and closes the
// server. The test reads that report. Usage: node interop-client.mjs <server bundle> <project root>
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'

const [serverBundle, projectRoot] = process.argv.slice(2)
const report = { errors: [] }

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverBundle],
  cwd: projectRoot,
  env: { ...getDefaultEnvironment(), RAILSFORGE_WORKSPACE_ROOT: projectRoot },
  stderr: 'pipe',
})
let serverClosed = false
transport.onclose = () => { serverClosed = true }
let stderr = ''
transport.stderr?.on('data', chunk => { stderr += chunk.toString() })

const client = new Client({ name: 'interop-check', version: '1.0.0' })

// Records the outcome of a call, whether it returned a result or raised a protocol error, so the test sees both.
async function call(name, args) {
  try {
    const result = await client.callTool({ name, arguments: args })
    return {
      ok: true,
      isError: result.isError === true,
      text: result.content?.[0]?.text ?? null,
      content: result.content ?? [],
      structured: result.structuredContent ?? null,
      meta: result._meta ?? null,
    }
  } catch (err) {
    return { ok: false, code: err?.code ?? null, message: String(err?.message ?? err) }
  }
}

try {
  await client.connect(transport) // initialize, with protocol version negotiation
  report.server = client.getServerVersion()
  report.capabilities = client.getServerCapabilities()

  const listed = await client.listTools()
  report.tools = listed.tools.map(tool => ({ name: tool.name, inputSchema: tool.inputSchema, annotations: tool.annotations ?? null }))

  report.getSchemaOrder = await call('get_schema', { model: 'Order' })
  report.listRoutesOrders = await call('list_routes', { filter: 'orders' })
  report.invalidArguments = await call('get_schema', { model: 42 })
  report.unknownTool = await call('no_such_tool', {})
  report.healthRoute = await call('list_routes', { filter: 'health' })
  report.servedAfterErrors = await call('list_routes', { filter: 'orders' })
  report.listPatterns = await call('list_patterns', { type: 'service' })
  report.similarPatterns = await call('find_similar_pattern', { name: 'CreateOrderService' })
  report.similarMiss = await call('find_similar_pattern', { name: 'NoSuchService' })
  report.exampleFile = await call('get_example_file', { pattern_type: 'service' })
  report.learningResource = await call('suggest_learning_resource', { diagnostic_id: 'SRP-FAT-CLASS' })
  report.listSkills = await call('list_skills', {})
  report.untrustedRake = await call('list_rake_tasks', {})
  report.noIndex = await call('get_dependencies', { name: 'Order' })
  // A transport that is closed is a transport failure: the call must not look like a tool result.
  await transport.close()
  report.afterTransportClosed = await call('list_routes', { filter: 'orders' })
} catch (err) {
  report.errors.push(String(err?.stack ?? err))
} finally {
  try { await client.close() } catch { /* already closed above */ }
  const started = Date.now()
  while (!serverClosed && Date.now() - started < 5000) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  report.serverClosedAfterClose = serverClosed
  report.serverStderr = stderr.slice(0, 2000)
  process.stdout.write(`${JSON.stringify(report)}\n`)
}
