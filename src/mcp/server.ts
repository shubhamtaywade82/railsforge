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
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ToolContext } from './tools/ToolContext'
import { RAILSFORGE_TOOLS } from './tools/definitions'

const workspaceRoot = path.resolve(process.env.RAILSFORGE_WORKSPACE_ROOT ?? process.cwd())
// dist/mcp/server.js -> dist/skills (the pinned ruby-agent-skills build); RAILSFORGE_SKILLS_DIR overrides.
const skillsPackDir = path.resolve(path.dirname(process.argv[1] ?? '.'), '..', 'skills')
const context = new ToolContext(workspaceRoot, skillsPackDir)

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

// Skills as MCP *resources* (read-only content); executable operations stay tools.
server.registerResource(
  'skills-catalog',
  'ruby-agent-skills://catalog',
  { title: 'Engineering skills catalog', description: 'All available Ruby/Rails engineering skills (id, family, description).', mimeType: 'application/json' },
  async uri => {
    const registry = context.getSkillRegistry()
    const skills = registry.list().map(s => ({ id: s.id, family: s.family, origin: s.origin, description: s.description }))
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ source: registry.source ?? null, skills }, null, 2) }] }
  },
)

server.registerResource(
  'skill',
  new ResourceTemplate('ruby-agent-skills://skill/{id}', {
    list: async () => ({
      resources: context.getSkillRegistry().list().map(s => ({ uri: `ruby-agent-skills://skill/${s.id}`, name: s.id, description: s.description.slice(0, 200), mimeType: 'text/markdown' })),
    }),
  }),
  { title: 'Engineering skill', description: 'The full SKILL.md of one skill.', mimeType: 'text/markdown' },
  async (uri, variables) => {
    const id = Array.isArray(variables.id) ? variables.id[0] : variables.id
    const text = context.getSkillRegistry().readSkill(String(id))
    if (!text) {throw new Error(`Unknown skill: ${String(id)}`)}
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] }
  },
)

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

void main()
