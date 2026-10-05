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

  it('opens a design pattern explanation in the editor (not a browser) for the active project', async () => {
    await openFile('rails_a', 'app/models/alphas.rb')
    await vscode.commands.executeCommand('railsforge.openPattern', 'service-object')
    const doc = vscode.window.activeTextEditor?.document
    assert.ok(doc, 'no editor opened')
    assert.strictEqual(doc.uri.scheme, 'railsforge')
    const text = doc.getText()
    assert.ok(text.startsWith('# Service Object'), text.slice(0, 80))
    assert.ok(text.includes('## In this project'), 'project section missing')
    assert.ok(text.includes('```ruby'), 'example missing')
  })

  it('serves read-only virtual project documents per root', async () => {
    const folders = vscode.workspace.workspaceFolders ?? []
    const a = folders.find(f => f.uri.fsPath.endsWith('rails_a'))!.uri.fsPath
    const open = async (kind: string, root: string): Promise<string> =>
      (await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: 'railsforge', path: `/${kind}.md`, query: new URLSearchParams({ root }).toString() }))).getText()
    const schema = await open('schema', a)
    assert.ok(schema.includes('## alphas'), schema)
    assert.ok(!schema.includes('## betas'))
    assert.ok((await open('toolchain', a)).includes('Project:'))
    assert.ok((await open('runtime', a)).includes('No snapshot yet'))
  })

  it('contributes the editor submenu, welcome views and virtual doc command', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8')) as {
      contributes: { submenus: Array<{ id: string }>; viewsWelcome: unknown[]; menus: Record<string, Array<{ submenu?: string }>> }
    }
    assert.ok(manifest.contributes.submenus.some(s => s.id === 'railsforge.editorSubmenu'))
    assert.ok(manifest.contributes.viewsWelcome.length >= 3)
    assert.ok(manifest.contributes.menus['editor/context'].some(m => m.submenu === 'railsforge.editorSubmenu'))
  })

  it('semantic context tool describes the active project only; graph virtual doc renders', async function () {
    this.timeout(120_000)
    const lm = (vscode as unknown as { lm?: { invokeTool(name: string, options: { input: object; toolInvocationToken: undefined }): Thenable<{ content: Array<{ value?: string }> }> } }).lm
    if (!lm?.invokeTool) {return this.skip()}
    const folders = vscode.workspace.workspaceFolders ?? []
    const a = folders.find(f => f.uri.fsPath.endsWith('rails_a'))!.uri.fsPath
    await openFile('rails_a', 'app/models/alphas.rb')
    const result = await lm.invokeTool('railsforge_get_semantic_context', { input: { file: 'app/models/alphas.rb', query: 'Alphas' }, toolInvocationToken: undefined })
    const text = result.content.map(part => part.value ?? '').join('')
    assert.ok(text.includes('Alphas'), text.slice(0, 300))
    assert.ok(!text.includes('Betas'), 'rails_b facts leaked into rails_a context')
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: 'railsforge', path: '/graph.md', query: new URLSearchParams({ root: a }).toString() }))
    assert.ok(doc.getText().includes('# Rails Semantic Graph'))
  })

  it('skills: route_skills runs in the editor and every contributed chatSkill file shipped in dist/skills', async function () {
    const lm = (vscode as unknown as { lm?: { invokeTool(name: string, options: { input: object; toolInvocationToken: undefined }): Thenable<{ content: Array<{ value?: string }> }> } }).lm
    const root = path.resolve(__dirname, '..', '..', '..')
    if (!fs.existsSync(path.join(root, 'dist', 'skills', 'catalog.json'))) {return this.skip()}

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { contributes: { chatSkills: Array<{ path: string }> } }
    for (const skill of manifest.contributes.chatSkills) {
      assert.ok(fs.existsSync(path.join(root, skill.path)), `chatSkill file missing: ${skill.path}`)
    }

    if (!lm?.invokeTool) {return this.skip()}
    await openFile('rails_a', 'app/models/alphas.rb')
    const result = await lm.invokeTool('railsforge_route_skills', { input: { task: 'add a validation and an association to Alphas', file: 'app/models/alphas.rb' }, toolInvocationToken: undefined })
    const text = result.content.map(part => part.value ?? '').join('')
    const routed = JSON.parse(text) as { routed: Array<{ id: string }> }
    assert.ok(routed.routed.some(r => r.id === 'rails-active-record'), text.slice(0, 400))
  })
})
