import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ExternalMcpBridge } from '../src/mcp/external/ExternalMcpBridge'
import { ExternalServerManager } from '../src/mcp/external/ExternalServerManager'

function fakeManager() {
  return {
    configure: vi.fn(),
    toolsFor: vi.fn(async () => [{
      serverId: 'rails',
      remoteName: 'get_schema',
      exposedName: 'rails__get_schema',
      description: 'Gets the schema.',
      jsonSchema: { type: 'object', properties: {} },
    }]),
    statusFor: vi.fn(async () => []),
    callTool: vi.fn(async () => 'remote text'),
    dispose: vi.fn(async () => undefined),
  }
}

describe('ExternalMcpBridge', () => {
  it('applies the valid entries and logs each invalid one once', () => {
    const manager = fakeManager()
    const logs: string[] = []
    const bridge = new ExternalMcpBridge(manager as unknown as ExternalServerManager, () => true, m => logs.push(m))
    const problems = bridge.reconfigure([{ id: 'rails', command: 'rails-tool' }, { id: 'Bad', command: 'x' }])
    expect(manager.configure).toHaveBeenCalledWith([expect.objectContaining({ id: 'rails', command: 'rails-tool' })])
    expect(problems).toHaveLength(1)
    expect(logs).toEqual([expect.stringContaining('entry 2 (Bad)')])
  })

  it('does not re-apply or re-log an unchanged setting, so every configuration change stays quiet', () => {
    const manager = fakeManager()
    const logs: string[] = []
    const bridge = new ExternalMcpBridge(manager as unknown as ExternalServerManager, () => true, m => logs.push(m))
    const raw = [{ id: 'Bad', command: 'x' }]
    bridge.reconfigure(raw)
    bridge.reconfigure(JSON.parse(JSON.stringify(raw)))
    expect(manager.configure).toHaveBeenCalledTimes(1)
    expect(logs).toHaveLength(1)
  })

  it('offers loop tools that call through the manager, with the project root', async () => {
    // A real directory: the audit record is written there, and a call whose audit cannot be written is refused.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-bridge-'))
    try {
      const manager = fakeManager()
      const bridge = new ExternalMcpBridge(manager as unknown as ExternalServerManager, () => true, () => undefined)
      const [tool] = await bridge.loopToolsFor(root)
      expect(manager.toolsFor).toHaveBeenCalledWith(root, true)
      await expect(tool.run({ model: 'Order' })).resolves.toBe('remote text')
      expect(manager.callTool).toHaveBeenCalledWith('rails', root, 'get_schema', { model: 'Order' })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses a call whose audit record cannot be written, rather than running it unaudited', async () => {
    const manager = fakeManager()
    const bridge = new ExternalMcpBridge(manager as unknown as ExternalServerManager, () => true, () => undefined)
    const [tool] = await bridge.loopToolsFor('/does/not/exist')
    await expect(tool.run({ model: 'Order' })).resolves.toContain('audit record could not be written')
    expect(manager.callTool).not.toHaveBeenCalled()
  })

  it('asks the manager for no tools when the workspace is untrusted', async () => {
    const manager = fakeManager()
    manager.toolsFor.mockResolvedValueOnce([])
    const bridge = new ExternalMcpBridge(manager as unknown as ExternalServerManager, () => false, () => undefined)
    await expect(bridge.loopToolsFor('/project')).resolves.toEqual([])
    expect(manager.toolsFor).toHaveBeenCalledWith('/project', false)
  })
})
