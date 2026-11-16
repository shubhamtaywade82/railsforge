// A small stdio MCP server used by the integration tests. It is started as a child process, so it exercises the real
// SDK client, the real transport, and real process exit and environment handling.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'echo-fixture', version: '1.0.0' })

server.registerTool(
  'echo',
  { description: 'Echoes text with the working directory it was started in.', inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } },
  async ({ text }) => ({ content: [{ type: 'text', text: `echo:${text}:${process.cwd()}` }] }),
)

server.registerTool(
  'env',
  { description: 'Returns the value of RF_FIXTURE_VALUE, or "unset".', inputSchema: {} },
  async () => ({ content: [{ type: 'text', text: process.env.RF_FIXTURE_VALUE ?? 'unset' }] }),
)

server.registerTool(
  'fail',
  { description: 'Always reports an error.', inputSchema: {} },
  async () => ({ isError: true, content: [{ type: 'text', text: 'boom' }] }),
)

server.registerTool(
  'exit_now',
  { description: 'Ends the server process.', inputSchema: {} },
  async () => {
    setTimeout(() => process.exit(3), 10)
    return { content: [{ type: 'text', text: 'exiting' }] }
  },
)

server.registerTool(
  'picture',
  { description: 'Returns an image block and a text block.', inputSchema: {} },
  async () => ({ content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }, { type: 'text', text: 'after image' }] }),
)

server.registerTool(
  'write_file',
  { description: 'Writes a file. Must never be offered unless allowed.', inputSchema: { path: z.string() } },
  async () => ({ content: [{ type: 'text', text: 'written' }] }),
)

await server.connect(new StdioServerTransport())
