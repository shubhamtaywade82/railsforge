import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

interface RailsForgeTestApi {
  editorExternalDefinitions(): { label: string; command: string; cwd: string }[]
}

const EXTENSION_ID = 'ShubhamTaywade.railsforge'
const SETTING = 'mcp.servers'

async function until(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {throw new Error('Timed out waiting for condition')}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/**
 * Whether this host offers stdio MCP definitions with a working directory: the definition API must exist, and the
 * version must be 1.105 or later (EDITOR_CWD_MIN_VERSION, verified against the shipped bundles).
 */
function hostOffersEditorDefinitions(): boolean {
  const lm = (vscode as unknown as { lm?: { registerMcpServerDefinitionProvider?: unknown } }).lm
  if (typeof lm?.registerMcpServerDefinitionProvider !== 'function') {return false}
  const [major, minor] = vscode.version.split('.').map(part => Number.parseInt(part, 10))
  return major > 1 || (major === 1 && minor >= 105)
}

const folder = (name: string): string => {
  const found = vscode.workspace.workspaceFolders?.find(f => path.basename(f.uri.fsPath) === name)
  assert.ok(found, `workspace folder ${name} not found`)
  return found.uri.fsPath
}

describe('external servers offered to the editor\'s own agent, in a real Extension Host', function () {
  let api: RailsForgeTestApi
  const config = () => vscode.workspace.getConfiguration('railsForge')

  before(async () => {
    const ext = vscode.extensions.getExtension<RailsForgeTestApi>(EXTENSION_ID)
    assert.ok(ext, `extension ${EXTENSION_ID} not found`)
    api = await ext.activate()
  })

  afterEach(async () => {
    // Leave the profile as it was. The setting is application-scoped, so VS Code refuses a workspace-level write;
    // that refusal is expected, and the workspace reset is best-effort for that reason.
    await config().update(SETTING, undefined, vscode.ConfigurationTarget.Global)
    try {
      await config().update(SETTING, undefined, vscode.ConfigurationTarget.Workspace)
    } catch {
      // expected: this setting cannot be written at workspace level
    }
  })

  it('offers nothing to the editor until a server is opted in at user level', () => {
    assert.deepStrictEqual(api.editorExternalDefinitions(), [])
  })

  it('offers an opted-in user-level server once per workspace folder, each with its folder as the working directory', async function () {
    if (!hostOffersEditorDefinitions()) {
      // Below 1.105 nothing is offered, and the check for that is the next test.
      this.skip()
    }
    await config().update(SETTING, [{ id: 'ask-ruby', command: 'node', args: ['--version'], exposeToEditor: true }], vscode.ConfigurationTarget.Global)
    await until(() => api.editorExternalDefinitions().length === 2)
    const definitions = api.editorExternalDefinitions()
    assert.deepStrictEqual(
      definitions.map(d => ({ label: d.label, command: d.command, cwd: d.cwd })).sort((a, b) => a.label.localeCompare(b.label)),
      [
        { label: 'ask-ruby (rails_a)', command: 'node', cwd: folder('rails_a') },
        { label: 'ask-ruby (rails_b)', command: 'node', cwd: folder('rails_b') },
      ],
    )
  })

  it('offers nothing to the editor on a host without the definition API or without cwd support (below 1.105)', async function () {
    if (hostOffersEditorDefinitions()) {this.skip()}
    await config().update(SETTING, [{ id: 'ask-ruby', command: 'node', exposeToEditor: true }], vscode.ConfigurationTarget.Global)
    await new Promise(resolve => setTimeout(resolve, 500))
    assert.deepStrictEqual(api.editorExternalDefinitions(), [])
  })

  it('does not offer a server that is only in workspace settings, so a repository cannot start a process for the editor', async () => {
    // The setting has application scope, so VS Code may refuse a workspace-level value outright. Either outcome is fine
    // here: what matters is that the editor is offered nothing.
    try {
      await config().update(SETTING, [{ id: 'from-repo', command: 'node', exposeToEditor: true }], vscode.ConfigurationTarget.Workspace)
    } catch {
      // refused by VS Code: the setting cannot be defined at workspace level
    }
    await new Promise(resolve => setTimeout(resolve, 500))
    assert.deepStrictEqual(api.editorExternalDefinitions(), [])
  })

  it('does not offer a user-level server that has not opted in with exposeToEditor', async () => {
    await config().update(SETTING, [{ id: 'own-agent-only', command: 'node' }], vscode.ConfigurationTarget.Global)
    await new Promise(resolve => setTimeout(resolve, 500))
    assert.deepStrictEqual(api.editorExternalDefinitions(), [])
  })
})
