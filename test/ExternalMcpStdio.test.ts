// End to end: the real @modelcontextprotocol/sdk client starts a real stdio server, through ExternalServerManager and the
// ExternalMcpBridge that the agent uses. Nothing here is mocked except the editor's trust flag.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ExternalServerManager } from '../src/mcp/external/ExternalServerManager'
import { sdkExternalClientFactory } from '../src/mcp/external/SdkExternalClient'
import { parseExternalServers } from '../src/mcp/external/ExternalServerConfig'
import { ExternalMcpBridge } from '../src/mcp/external/ExternalMcpBridge'
import { AUDIT_RELATIVE_PATH } from '../src/mcp/audit/McpAuditRecorder'

const FIXTURE = path.join(__dirname, 'fixtures', 'mcp', 'echo-server.mjs')

describe('external stdio MCP server, end to end', () => {
  let root: string
  let logs: string[]
  let trusted: boolean
  let manager: ExternalServerManager
  let bridge: ExternalMcpBridge

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-stdio-')))
    logs = []
    trusted = true
    manager = new ExternalServerManager({
      ...sdkExternalClientFactory({ onStderr: line => logs.push(`stderr: ${line}`) }),
      log: (_level, message) => logs.push(message),
      connectTimeoutMs: 20_000,
      callTimeoutMs: 20_000,
      retryBackoffMs: 60_000,
    })
    bridge = new ExternalMcpBridge(manager, () => trusted, message => logs.push(message))
    const { servers, problems } = parseExternalServers([{
      id: 'echo',
      command: process.execPath,
      args: [FIXTURE],
      env: { RF_FIXTURE_VALUE: 'from-configuration' },
      allowTools: ['echo', 'env', 'fail', 'exit_now', 'picture'],
      // The fixture's tools are declared low-risk here, so these tests exercise the transport and not approval.
      toolRisk: { echo: 'R2', env: 'R2', fail: 'R2', exit_now: 'R2', picture: 'R2' },
    }])
    expect(problems).toEqual([])
    bridge.reconfigure(servers)
  })

  afterEach(async () => {
    await manager.dispose()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('starts the server, lists its tools, and offers only the allowed ones', async () => {
    const tools = await manager.toolsFor(root, true)
    expect(tools.map(t => t.exposedName).sort()).toEqual(['echo__echo', 'echo__env', 'echo__exit_now', 'echo__fail', 'echo__picture'])
    expect(tools.map(t => t.remoteName)).not.toContain('write_file')
  }, 30_000)

  it('runs the tool in the project root, so each project gets its own working directory', async () => {
    const [echo] = (await bridge.loopToolsFor(root)).filter(t => t.name === 'echo__echo')
    await expect(echo.run({ text: 'hi' })).resolves.toBe(`echo:hi:${root}`)
  }, 30_000)

  it('passes the configured environment to the process, on top of the default environment', async () => {
    const [env] = (await bridge.loopToolsFor(root)).filter(t => t.name === 'echo__env')
    await expect(env.run({})).resolves.toBe('from-configuration')
  }, 30_000)

  it('turns a server-reported error into a failed call, without exposing the server internals', async () => {
    const [fail] = (await bridge.loopToolsFor(root)).filter(t => t.name === 'echo__fail')
    await expect(fail.run({})).rejects.toThrow('boom')
  }, 30_000)

  it('keeps the text of a mixed result and names the non-text content it leaves out', async () => {
    const tools = await bridge.loopToolsFor(root)
    const picture = tools.find(t => t.name === 'echo__picture')
    expect(picture).toBeDefined()
    await expect(picture!.run({})).resolves.toBe('[image content omitted]\nafter image')
  }, 30_000)

  it('marks a server whose process exits as failed, and does not restart it during the backoff', async () => {
    const [exit] = (await bridge.loopToolsFor(root)).filter(t => t.name === 'echo__exit_now')
    // The server answers, then ends its own process a moment later.
    await expect(exit.run({})).resolves.toBe('exiting')
    await vi.waitFor(async () => {
      const [status] = await manager.statusFor(root, true)
      expect(status.state).toBe('failed')
    }, { timeout: 10_000 })
    expect(logs.some(line => line.includes('the server process exited'))).toBe(true)
    expect(await manager.toolsFor(root, true)).toEqual([])
    await expect(exit.run({})).rejects.toThrow('echo is not connected')
  }, 30_000)

  it('offers nothing and starts nothing in an untrusted workspace', async () => {
    trusted = false
    expect(await bridge.loopToolsFor(root)).toEqual([])
    const [status] = await manager.statusFor(root, false)
    expect(status.state).toBe('untrusted')
  }, 30_000)

  it('audits each external call with argument names only, never the values', async () => {
    const [echo] = (await bridge.loopToolsFor(root)).filter(t => t.name === 'echo__echo')
    await echo.run({ text: 'SecretValueThatMustNotBeLogged' })
    const audit = fs.readFileSync(path.join(root, AUDIT_RELATIVE_PATH), 'utf8')
    expect(audit).toContain('"tool":"echo__echo"')
    expect(audit).toContain('"argumentNames":["text"]')
    expect(audit).not.toContain('SecretValueThatMustNotBeLogged')
  }, 30_000)

  it('shows the status report with the offered tools and no environment values', async () => {
    await manager.toolsFor(root, true)
    const report = await bridge.statusReport(root)
    expect(report).toContain('| echo | running |')
    expect(report).toContain('`echo__echo`')
    expect(report).not.toContain('from-configuration')
  }, 30_000)
})
