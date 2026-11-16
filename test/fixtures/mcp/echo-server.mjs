// A small stdio MCP server used by the integration tests. It is started as a child process, so it exercises the real
// SDK client, the real transport, and real process exit, cancellation and environment handling.
//
// What reaches the server is written to files in its working directory (the project root), so tests can check it:
//   started.log    one line per process start
//   calls.log      one line per tool invocation that reached a handler
//   cancelled.marker   written when a `slow` call is cancelled by the client
//   written.marker     written when `write_file` runs
import * as fs from 'fs'
import * as path from 'path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const root = process.cwd()
const record = (file, line) => fs.appendFileSync(path.join(root, file), `${line}\n`)
record('started.log', 'start')
const invoked = name => record('calls.log', name)

const server = new McpServer({ name: 'echo-fixture', version: '1.0.0' })

server.registerTool(
  'echo',
  { description: 'Echoes text with the working directory it was started in.', inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } },
  async ({ text }) => {
    invoked('echo')
    return { content: [{ type: 'text', text: `echo:${text}:${process.cwd()}` }] }
  },
)

server.registerTool(
  'env',
  { description: 'Returns the value of RF_FIXTURE_VALUE, or "unset".', inputSchema: {} },
  async () => {
    invoked('env')
    return { content: [{ type: 'text', text: process.env.RF_FIXTURE_VALUE ?? 'unset' }] }
  },
)

server.registerTool(
  'fail',
  { description: 'Always reports an error.', inputSchema: {} },
  async () => {
    invoked('fail')
    return { isError: true, content: [{ type: 'text', text: 'boom' }] }
  },
)

server.registerTool(
  'exit_now',
  { description: 'Ends the server process.', inputSchema: {} },
  async () => {
    invoked('exit_now')
    setTimeout(() => process.exit(3), 10)
    return { content: [{ type: 'text', text: 'exiting' }] }
  },
)

server.registerTool(
  'picture',
  { description: 'Returns an image block and a text block.', inputSchema: {} },
  async () => {
    invoked('picture')
    return { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }, { type: 'text', text: 'after image' }] }
  },
)

server.registerTool(
  'slow',
  { description: 'Waits for up to 20 seconds, and stops early when the client cancels the call.', inputSchema: {} },
  async (_args, extra) => {
    invoked('slow')
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 20_000)
      extra.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        fs.writeFileSync(path.join(root, 'cancelled.marker'), 'yes')
        resolve(undefined)
      }, { once: true })
    })
    return { content: [{ type: 'text', text: 'finished' }] }
  },
)

server.registerTool(
  'write_file',
  { description: 'Writes a marker file in the project. Must never run unless it is allowed and approved.', inputSchema: { path: z.string() } },
  async ({ path: target }) => {
    invoked('write_file')
    fs.writeFileSync(path.join(root, 'written.marker'), target)
    return { content: [{ type: 'text', text: 'written' }] }
  },
)

await server.connect(new StdioServerTransport())
