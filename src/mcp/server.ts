/**
 * RailsForge MCP server (Phase 14) - exposes the same schema/routes/pattern/dependency
 * intelligence RailsForge uses internally as MCP tools, so any MCP-capable AI client
 * (not just the built-in @rails chat participant) can query a Rails project's context.
 *
 * Runs as a standalone Node process (started by the MCP client via stdio), NOT inside
 * the VS Code extension host — it imports only the vscode-free indexer classes
 * (SchemaIndexer, RoutesIndexer, ProjectPatternIndexer all have zero `vscode` imports)
 * and reads the same workspace-local .railsforge/index.sqlite3 the extension's
 * PersistentIndexManager maintains when the workspace is open in VS Code with
 * RailsForge installed. If that file doesn't exist yet, dependency/duplicate tools
 * degrade to a clear "index not built" message instead of failing silently.
 */

import * as path from 'path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ToolContext } from './tools/ToolContext'
import { RAILSFORGE_TOOLS } from './tools/definitions'

const workspaceRoot = path.resolve(process.env.RAILSFORGE_WORKSPACE_ROOT ?? process.cwd())
const context = new ToolContext(workspaceRoot)

const server = new McpServer({ name: 'railsforge', version: '0.2.0' })

// Same tool implementations the in-editor Language Model tools use (src/mcp/tools/definitions.ts).
for (const tool of RAILSFORGE_TOOLS) {
  server.registerTool(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
    (async (input: Record<string, unknown>) => ({
      content: [{ type: 'text' as const, text: await tool.handler(context, input ?? {}) }],
    })) as never,
  )
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

void main()
