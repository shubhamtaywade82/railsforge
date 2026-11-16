// Opt-in live check against a real external stdio MCP server. It is skipped unless RAILSFORGE_LIVE_MCP_COMMAND names
// the executable, so CI never installs or starts third-party code. Example, from the repository root:
//
//   RAILSFORGE_LIVE_MCP_COMMAND=ask-ruby-harness-mcp \
//   RAILSFORGE_LIVE_MCP_ROOT=/path/to/a/ruby/project \
//   RAILSFORGE_LIVE_MCP_ALLOW=read_model,schema_graph,read_log \
//   npx vitest run test/ExternalMcpLive.test.ts
//
// RAILSFORGE_LIVE_MCP_ARGS is an optional JSON array of arguments, for example ["stdio"]. The default allowlist is
// read-only. Do not add run_command to it: it runs arbitrary shell commands, which RailsForge never exposes natively.
import { describe, it, expect, afterAll } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import { ExternalServerManager } from '../src/mcp/external/ExternalServerManager'
import { sdkExternalClientFactory } from '../src/mcp/external/SdkExternalClient'
import { parseExternalServers } from '../src/mcp/external/ExternalServerConfig'

const command = process.env.RAILSFORGE_LIVE_MCP_COMMAND
const root = process.env.RAILSFORGE_LIVE_MCP_ROOT ?? path.join(__dirname, '..', 'examples', 'rails-monolith')
const allow = (process.env.RAILSFORGE_LIVE_MCP_ALLOW ?? 'read_model,schema_graph,read_log').split(',').map(s => s.trim()).filter(Boolean)
const args: unknown = JSON.parse(process.env.RAILSFORGE_LIVE_MCP_ARGS ?? '[]')

describe.skipIf(!command)('live external MCP server (opt-in)', () => {
  const manager = new ExternalServerManager({
    ...sdkExternalClientFactory(),
    log: () => undefined,
    connectTimeoutMs: 30_000,
    callTimeoutMs: 60_000,
    retryBackoffMs: 60_000,
  })

  afterAll(async () => {
    await manager.dispose()
  })

  it('starts in the project root, and offers exactly the allowed tools it provides', async () => {
    expect(fs.existsSync(root)).toBe(true)
    const parsed = parseExternalServers([{ id: 'live', command, args: Array.isArray(args) ? args : [], allowTools: allow }])
    expect(parsed.problems).toEqual([])
    manager.configure(parsed.servers)

    const [status] = await manager.statusFor(root, true)
    expect(status.problems).toEqual([])
    expect(status.state).toBe('running')
    expect(status.reason).toBeUndefined()
    // Every name in the allowlist must be one the server provides; a missing one is reported as a problem.
    expect(status.tools.sort()).toEqual([...allow].sort())
  }, 90_000)

  it('does not offer a tool that is not in the allowlist', async () => {
    const tools = await manager.toolsFor(root, true)
    expect(tools.map(t => t.remoteName)).not.toContain('run_command')
  }, 90_000)
})
