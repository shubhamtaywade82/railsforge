/**
 * Installed-VSIX smoke checks. Runs inside a real VS Code that has the *packaged* railsforge.vsix
 * installed (scripts/vsix-smoke.mjs); the extension under test is loaded from the extensions
 * directory, not from the source tree. Exports run() for @vscode/test-electron.
 */
import * as assert from 'assert'
import * as cp from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

interface RailsForgeTestApi {
  getActiveProjectRoot(): string
  getSchemaTableNames(): string[]
  getAstIndexStatuses(): Record<string, string>
}

const EXTENSION_ID = 'ShubhamTaywade.railsforge'
type Check = { name: string; fn: () => Promise<void> }

function required(name: string): string {
  const v = process.env[name]
  if (!v) { throw new Error(`${name} not set — run via scripts/vsix-smoke.mjs`) }
  return v
}

async function until(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) { throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`) }
    await new Promise(r => setTimeout(r, 100))
  }
}

/** Minimal MCP stdio client: initialize + tools/list against the bundled server. */
function mcpListTools(serverJs: string, cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [serverJs], {
      cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', RAILSFORGE_WORKSPACE_ROOT: cwd },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let buffer = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error(`MCP server timed out. stderr: ${stderr}`)) }, 30_000)
    const send = (msg: object): void => { child.stdin.write(`${JSON.stringify(msg)}\n`) }
    child.stderr.on('data', d => { stderr += String(d) })
    child.on('error', err => { clearTimeout(timer); reject(err) })
    child.on('exit', code => { if (code) { clearTimeout(timer); reject(new Error(`MCP server exited ${code}. stderr: ${stderr}`)) } })
    child.stdout.on('data', chunk => {
      buffer += String(chunk)
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) { continue }
        let msg: { id?: number; result?: { tools?: Array<{ name: string }> } }
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' })
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
        } else if (msg.id === 2) {
          clearTimeout(timer)
          child.kill()
          resolve((msg.result?.tools ?? []).map(t => t.name))
        }
      }
    })
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'vsix-smoke', version: '0' } } })
  })
}

export async function run(): Promise<void> {
  const extensionsDir = required('RAILSFORGE_SMOKE_EXTENSIONS_DIR')
  const expectedVersion = required('RAILSFORGE_SMOKE_VERSION')
  const workspaceRoot = required('RAILSFORGE_SMOKE_WORKSPACE')

  const ext = vscode.extensions.getExtension<RailsForgeTestApi>(EXTENSION_ID)
  assert.ok(ext, `${EXTENSION_ID} is not installed — manifest publisher/name mismatch or install failed`)
  const root = ext.extensionPath
  let api: RailsForgeTestApi | undefined

  const checks: Check[] = [
    { name: 'loads from the extensions directory (not a development path)', fn: async () => {
      const rel = path.relative(fs.realpathSync(extensionsDir), fs.realpathSync(root))
      assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel), `extension loaded from ${root}, outside ${extensionsDir}`)
    } },
    { name: 'installed version matches the built package.json', fn: async () => {
      assert.strictEqual((ext.packageJSON as { version: string }).version, expectedVersion)
    } },
    { name: 'ships runtime payload and omits sources', fn: async () => {
      for (const f of ['dist/extension.js', 'dist/mcp/server.js', 'dist/skills/catalog.json', 'dist/skills/.pin.json', 'package.json']) {
        assert.ok(fs.existsSync(path.join(root, f)), `missing from VSIX: ${f}`)
      }
      for (const f of ['src', 'test', 'test-host', '.github', 'node_modules', 'webpack.config.js', 'pnpm-lock.yaml']) {
        assert.ok(!fs.existsSync(path.join(root, f)), `should not be in VSIX: ${f}`)
      }
    } },
    { name: 'bundled skills catalog is populated', fn: async () => {
      const catalog = JSON.parse(fs.readFileSync(path.join(root, 'dist/skills/catalog.json'), 'utf8')) as { skills?: Record<string, unknown> }
      assert.ok(catalog.skills && Object.keys(catalog.skills).length > 0, 'catalog.json has no skills')
    } },
    { name: 'native modules load in this Electron and work', fn: async () => {
      const nm = path.join(root, 'dist', 'node_modules')
      const Database = require(path.join(nm, 'better-sqlite3')) as new (f: string) => { exec(s: string): void; prepare(s: string): { run(...a: unknown[]): unknown; get(): { v: string } }; close(): void }
      const db = new Database(':memory:')
      db.exec('CREATE TABLE t (v TEXT)')
      db.prepare('INSERT INTO t (v) VALUES (?)').run('ok')
      assert.strictEqual(db.prepare('SELECT v FROM t').get().v, 'ok')
      db.close()
      const Parser = require(path.join(nm, 'tree-sitter')) as new () => { setLanguage(l: unknown): void; parse(s: string): { rootNode: { hasError: boolean; type: string } } }
      const Ruby = require(path.join(nm, 'tree-sitter-ruby'))
      const parser = new Parser()
      parser.setLanguage(Ruby)
      const tree = parser.parse('class A\n  def b; end\nend\n')
      assert.strictEqual(tree.rootNode.type, 'program')
      assert.strictEqual(tree.rootNode.hasError, false)
    } },
    { name: 'activates', fn: async () => {
      api = await ext.activate()
      assert.ok(ext.isActive)
    } },
    { name: 'registers every contributed command', fn: async () => {
      const contributed = ((ext.packageJSON as { contributes: { commands: Array<{ command: string }> } }).contributes.commands).map(c => c.command)
      const registered = new Set(await vscode.commands.getCommands(true))
      const missing = contributed.filter(c => !registered.has(c))
      assert.deepStrictEqual(missing, [], `contributed but not registered: ${missing.join(', ')}`)
    } },
    { name: 'registers every contributed Language Model tool', fn: async () => {
      const contributed = ((ext.packageJSON as { contributes: { languageModelTools?: Array<{ name: string }> } }).contributes.languageModelTools ?? []).map(t => t.name)
      assert.ok(contributed.length > 0, 'no languageModelTools contributed')
      const live = new Set(vscode.lm.tools.map(t => t.name))
      const missing = contributed.filter(n => !live.has(n))
      assert.deepStrictEqual(missing, [], `LM tools not registered: ${missing.join(', ')}`)
    } },
    { name: 'bundled MCP server starts and lists tools over stdio', fn: async () => {
      const tools = await mcpListTools(path.join(root, 'dist', 'mcp', 'server.js'), workspaceRoot)
      assert.ok(tools.length > 0, 'MCP tools/list returned nothing')
      assert.ok(tools.includes('get_semantic_context'), `get_semantic_context missing from ${tools.join(', ')}`)
    } },
    { name: 'indexes a Rails project with the native AST index (not "unsupported")', fn: async () => {
      assert.ok(api, 'activate() did not return the test API')
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspaceRoot, 'app', 'models', 'alphas.rb')))
      await vscode.window.showTextDocument(doc)
      await until(() => api!.getSchemaTableNames().includes('alphas'), 20_000, 'schema table "alphas"')
      await until(() => {
        const s = Object.values(api!.getAstIndexStatuses())
        return s.length > 0 && s.every(v => v !== 'starting' && v !== 'idle')
      }, 45_000, 'AST index to settle')
      assert.deepStrictEqual([...new Set(Object.values(api.getAstIndexStatuses()))], ['ready'], 'AST index must be ready in the packaged extension')
    } },
  ]

  const failures: string[] = []
  for (const { name, fn } of checks) {
    try {
      await fn()
      console.log(`  ✔ ${name}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  ✖ ${name}\n      ${msg}`)
      failures.push(`${name}: ${msg}`)
    }
  }
  if (failures.length) { throw new Error(`${failures.length} installed-VSIX check(s) failed:\n${failures.join('\n')}`) }
}
