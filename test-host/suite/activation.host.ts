import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

interface RailsForgeTestApi {
  getActiveProjectRoot(): string
  getSchemaTableNames(): string[]
  getAstIndexStatuses(): Record<string, string>
  countRbsMethods(filePath: string, methodName: string): number
  getDevDocsCacheDir(filePath: string): string
  discoverTestTree(): Promise<string[]>
}

const EXTENSION_ID = 'ShubhamTaywade.railsforge'

async function until(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {throw new Error('Timed out waiting for condition')}
    await new Promise(r => setTimeout(r, 100))
  }
}

async function openFile(folderName: string, relPath: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.find(f => path.basename(f.uri.fsPath) === folderName)
  assert.ok(folder, `workspace folder ${folderName} not found`)
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, relPath))
  await vscode.window.showTextDocument(doc)
}

describe('RailsForge in a real Extension Host', function () {
  let api: RailsForgeTestApi

  before(async () => {
    const ext = vscode.extensions.getExtension<RailsForgeTestApi>(EXTENSION_ID)
    assert.ok(ext, `extension ${EXTENSION_ID} not found — manifest publisher/name mismatch?`)
    api = await ext.activate()
  })

  it('activates', () => {
    assert.ok(vscode.extensions.getExtension(EXTENSION_ID)?.isActive)
  })

  it('registers every command contributed in package.json', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8')) as {
      contributes: { commands: Array<{ command: string }> }
    }
    const registered = new Set(await vscode.commands.getCommands(true))
    const missing = manifest.contributes.commands.map(c => c.command).filter(c => !registered.has(c))
    assert.deepStrictEqual(missing, [], `contributed but not registered: ${missing.join(', ')}`)
  })

  it('multi-root: indexes the schema of the folder that owns the active editor', async () => {
    await openFile('rails_a', 'app/models/alphas.rb')
    await until(() => api.getSchemaTableNames().includes('alphas'))
    assert.ok(api.getActiveProjectRoot().endsWith('rails_a'))
    assert.ok(!api.getSchemaTableNames().includes('betas'))

    await openFile('rails_b', 'app/models/betas.rb')
    await until(() => api.getSchemaTableNames().includes('betas'))
    assert.ok(api.getActiveProjectRoot().endsWith('rails_b'))
    assert.ok(!api.getSchemaTableNames().includes('alphas'), 'rails_a schema leaked into rails_b context')
  })

  it('multi-root: each visited root gets its own AST index entry that settles (ready or explicitly unsupported)', async () => {
    await openFile('rails_a', 'app/models/alphas.rb')
    await openFile('rails_b', 'app/models/betas.rb')
    const settled = (): boolean => {
      const statuses = api.getAstIndexStatuses()
      const roots = Object.keys(statuses)
      return roots.some(r => r.endsWith('rails_a')) && roots.some(r => r.endsWith('rails_b'))
        && Object.values(statuses).every(s => s !== 'starting' && s !== 'idle')
    }
    await until(settled, 45_000)
    for (const status of Object.values(api.getAstIndexStatuses())) {
      assert.ok(['ready', 'unsupported'].includes(status), `unexpected AST index status: ${status}`)
    }
  })

  it('multi-root: RBS signatures and the DevDocs cache are per project', () => {
    const folders = vscode.workspace.workspaceFolders ?? []
    const a = folders.find(f => f.uri.fsPath.endsWith('rails_a'))!.uri.fsPath
    const b = folders.find(f => f.uri.fsPath.endsWith('rails_b'))!.uri.fsPath
    const fileA = path.join(a, 'app', 'models', 'alphas.rb')
    const fileB = path.join(b, 'app', 'models', 'betas.rb')

    assert.strictEqual(api.countRbsMethods(fileA, 'only_in_a'), 1)
    assert.strictEqual(api.countRbsMethods(fileA, 'only_in_b'), 0)
    assert.strictEqual(api.countRbsMethods(fileB, 'only_in_b'), 1)
    assert.strictEqual(api.countRbsMethods(fileB, 'only_in_a'), 0)

    assert.strictEqual(api.getDevDocsCacheDir(fileA), path.join(a, '.railsforge', 'devdocs'))
    assert.strictEqual(api.getDevDocsCacheDir(fileB), path.join(b, '.railsforge', 'devdocs'))
  })

  it('task provider offers RailsForge tasks for each Rails root, executed without a shell', async () => {
    const tasks = await vscode.tasks.fetchTasks({ type: 'railsforge' })
    const names = tasks.map(t => `${(t.scope as vscode.WorkspaceFolder).name}:${t.name}`)
    for (const folder of ['rails_a', 'rails_b']) {
      assert.ok(names.includes(`${folder}:RuboCop: lint`), `missing RuboCop task for ${folder}: ${names.join(', ')}`)
      assert.ok(names.includes(`${folder}:Rails: db:migrate`), `missing db:migrate for ${folder}`)
    }
    const rubocop = tasks.find(t => t.name === 'RuboCop: lint')!
    assert.ok(rubocop.execution instanceof vscode.ProcessExecution)
    assert.deepStrictEqual(rubocop.problemMatchers, ['$rubocop-railsforge'])
  })

  it('Test Explorer discovers nested RSpec groups across the workspace', async () => {
    const tree = await api.discoverTestTree()
    const text = tree.join('\n')
    assert.ok(text.includes('alphas_spec.rb'), `file item missing:\n${text}`)
    assert.ok(tree.includes('  Alphas'), `top-level describe missing:\n${text}`)
    assert.ok(tree.includes('    #name'), `nested describe missing:\n${text}`)
    assert.ok(tree.includes('      when blank'), `context missing:\n${text}`)
    assert.ok(tree.includes('        is invalid'), `nested example missing:\n${text}`)
  })

  it('registers RailsForge Language Model tools and they run against the active project', async function () {
    const lm = (vscode as unknown as { lm?: { tools: Array<{ name: string }>; invokeTool(name: string, options: { input: object; toolInvocationToken: undefined }): Thenable<{ content: Array<{ value?: string }> }> } }).lm
    if (!lm?.tools) {return this.skip()}
    assert.ok(lm.tools.some(t => t.name === 'railsforge_get_schema'), 'railsforge_get_schema not registered')
    await openFile('rails_a', 'app/models/alphas.rb')
    const result = await lm.invokeTool('railsforge_get_schema', { input: {}, toolInvocationToken: undefined })
    const text = result.content.map(part => part.value ?? '').join('')
    assert.ok(text.includes('alphas'), `unexpected tool output: ${text.slice(0, 200)}`)
    assert.ok(!text.includes('betas'), 'rails_b schema leaked into the rails_a tool call')
  })
})
