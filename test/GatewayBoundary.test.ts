// Static boundary: an external MCP capability reaches the agent only through the ToolGateway. These checks read the source
// tree, so a new call site that bypasses the gateway fails the suite instead of waiting for a review to notice it.
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const SRC = path.join(__dirname, '..', 'src')

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {return sourceFiles(full)}
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

/** Lines that call a method named `callTool` (a call, not a declaration), with their file. */
function callSites(pattern: RegExp): Array<{ file: string; line: string }> {
  const sites: Array<{ file: string; line: string }> = []
  for (const file of sourceFiles(SRC)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (line.trim().startsWith('*') || line.trim().startsWith('//')) {continue}
      // Allow-lists use forward slashes on every platform; path.relative uses the platform separator (a backslash on Windows).
      if (pattern.test(line)) {sites.push({ file: path.relative(SRC, file).split(path.sep).join('/'), line: line.trim() })}
    }
  }
  return sites
}

describe('the ToolGateway is the only path to external tools', () => {
  it('only the manager, the SDK adapter and the gateway call a server\'s callTool', () => {
    const allowed = new Set(['mcp/external/ExternalServerManager.ts', 'mcp/external/SdkExternalClient.ts', 'mcp/gateway/ToolGateway.ts'])
    const offenders = callSites(/\.callTool\(/).filter(site => !allowed.has(site.file))
    expect(offenders).toEqual([])
  })

  it('only the gateway builds the loop tools for external servers', () => {
    const allowed = new Set(['mcp/gateway/ToolGateway.ts', 'mcp/external/ExternalTools.ts'])
    const offenders = callSites(/externalLoopTool\(/).filter(site => !allowed.has(site.file))
    expect(offenders).toEqual([])
  })

  it('the bridge reaches tools only through the gateway, never through the manager', () => {
    const bridge = fs.readFileSync(path.join(SRC, 'mcp', 'external', 'ExternalMcpBridge.ts'), 'utf8')
    expect(bridge).toContain('this.gateway.loopToolsFor(')
    expect(bridge).not.toMatch(/manager\.callTool\(|manager\.toolsFor\(/)
  })

  it('the RailsForge tool list the gateway must not collide with is still the native one', () => {
    const extension = fs.readFileSync(path.join(SRC, 'extension.ts'), 'utf8')
    expect(extension).toContain('nativeNames: new Set(RAILSFORGE_TOOLS.map(def => def.name))')
  })
})

describe('every external call is an invocation that passes the policy', () => {
  it('the gateway runs each external call through invokeTool, which applies policy, approval and audit', () => {
    const externalTools = fs.readFileSync(path.join(SRC, 'mcp', 'external', 'ExternalTools.ts'), 'utf8')
    expect(externalTools).toMatch(/await invokeTool\(definition,/)
    expect(externalTools).toMatch(/validate: input =>/)
  })

  it('native tools keep their own path, and it still passes no approval port', () => {
    const native = fs.readFileSync(path.join(SRC, 'agent', 'LoopTools.ts'), 'utf8')
    expect(native).not.toMatch(/approval:/)
  })
})
