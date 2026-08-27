import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from 'vscode'
import { RailsChatViewProvider } from '../src/chat/RailsChatViewProvider'

vi.mock('../src/chat/ChatDiffApplier', () => ({
  applyDiffToFile: vi.fn(),
  applyFullFileReplacement: vi.fn(),
  createNewFile: vi.fn(),
}))

vi.mock('../src/util/Logger', () => ({
  Logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { applyDiffToFile, applyFullFileReplacement, createNewFile } from '../src/chat/ChatDiffApplier'

const mockedApplyDiff = vi.mocked(applyDiffToFile)
const mockedReplaceFile = vi.mocked(applyFullFileReplacement)
const mockedCreateFile = vi.mocked(createNewFile)

const mockAgent = {
  healthCheck: vi.fn().mockResolvedValue(true),
  run: vi.fn().mockResolvedValue({ success: true, response: 'AI response here', iterations: 1 }),
} as any

const mockSchemaIndexer = {
  getAllTables: vi.fn().mockReturnValue([]),
} as any

const mockRoutesIndexer = {
  getAllRoutes: vi.fn().mockReturnValue([]),
} as any

const mockPatternNames = vi.fn().mockReturnValue([])

const extensionUri = new vscode.Uri('/test/workspace')

function createProvider() {
  return new RailsChatViewProvider(
    extensionUri,
    mockAgent,
    mockSchemaIndexer,
    mockRoutesIndexer,
    mockPatternNames,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(vscode.window, 'activeTextEditor', { value: undefined, configurable: true })
  Object.defineProperty(vscode.workspace, 'workspaceFolders', { value: [{ uri: { fsPath: '/test/workspace' } }], configurable: true })
})

describe('RailsChatViewProvider', () => {
  it('resolveWebviewView sets options and html', () => {
    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    expect(wvView.webview.options.enableScripts).toBe(true)
    expect(wvView.webview.html).toContain('RailsForge AI Chat')
  })

  it('resolveWebviewView sends status after setup', async () => {
    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    const postSpy = vi.spyOn(wvView.webview, 'postMessage')

    provider.resolveWebviewView(wvView)
    await vi.waitFor(() => expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'statusUpdate' }),
    ), { timeout: 1000 })
  })

  it('statusUpdate includes isOnline, tablesCount, routesCount', async () => {
    vi.mocked(mockSchemaIndexer.getAllTables).mockReturnValue([
      { name: 'users', columns: new Map() },
      { name: 'posts', columns: new Map() },
    ])
    vi.mocked(mockRoutesIndexer.getAllRoutes).mockReturnValue([
      { verb: 'GET', uriPattern: '/users', controller: 'users', action: 'index' },
    ])

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    const postSpy = vi.spyOn(wvView.webview, 'postMessage')

    provider.resolveWebviewView(wvView)
    await vi.waitFor(() => expect(postSpy).toHaveBeenCalled(), { timeout: 1000 })

    const msg = postSpy.mock.calls[0][0] as any
    expect(msg.isOnline).toBe(true)
    expect(msg.tablesCount).toBe(2)
    expect(msg.routesCount).toBe(1)
    expect(msg.currentFile).toBe('No file open')
  })

  it('statusUpdate shows relative path when editor is active', async () => {
    const doc = new vscode.TextDocument('/test/workspace/app/models/user.rb', 'ruby', 'code')
    const editor = { document: doc, selection: new vscode.Selection(0, 0, 0, 0) }
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: editor, configurable: true })

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    const postSpy = vi.spyOn(wvView.webview, 'postMessage')

    provider.resolveWebviewView(wvView)
    await vi.waitFor(() => expect(postSpy).toHaveBeenCalled(), { timeout: 1000 })

    const msg = postSpy.mock.calls[0][0] as any
    expect(msg.currentFile).toBe('user.rb')
  })

  it('webviewReady message triggers postStatus', async () => {
    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    const postSpy = vi.spyOn(wvView.webview, 'postMessage')

    provider.resolveWebviewView(wvView)
    postSpy.mockClear()

    wvView.webview.simulateMessage({ type: 'webviewReady' })

    await vi.waitFor(() => expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'statusUpdate' }),
    ), { timeout: 1000 })
  })

  it('refreshStatus message triggers postStatus', async () => {
    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    const postSpy = vi.spyOn(wvView.webview, 'postMessage')

    provider.resolveWebviewView(wvView)
    postSpy.mockClear()

    wvView.webview.simulateMessage({ type: 'refreshStatus' })

    await vi.waitFor(() => expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'statusUpdate' }),
    ), { timeout: 1000 })
  })

  it('sendPrompt message calls agent and streams response', async () => {
    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    const postSpy = vi.spyOn(wvView.webview, 'postMessage')

    provider.resolveWebviewView(wvView)
    postSpy.mockClear()

    await wvView.webview.simulateMessage({ type: 'sendPrompt', prompt: 'explain this code', includeContext: false })

    expect(mockAgent.run).toHaveBeenCalledWith('explain this code', expect.objectContaining({
      fileContent: '',
      workspaceRoot: '/test/workspace',
    }))

    const types = postSpy.mock.calls.map(c => (c[0] as any).type)
    expect(types).toContain('appendMessage')
    expect(types).toContain('stopStreaming')
  })

  it('sendPrompt with includeContext sends active editor content', async () => {
    const doc = new vscode.TextDocument('/test/workspace/app/models/user.rb', 'ruby', 'class User\nend')
    const editor = { document: doc, selection: new vscode.Selection(0, 0, 1, 0) }
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: editor, configurable: true })

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'sendPrompt', prompt: 'optimize', includeContext: true })

    expect(mockAgent.run).toHaveBeenCalledWith('optimize', expect.objectContaining({
      fileContent: 'class User\nend',
      fileName: '/test/workspace/app/models/user.rb',
    }))
  })

  it('sendPrompt injects @schema context when mentioned', async () => {
    vi.mocked(mockSchemaIndexer.getAllTables).mockReturnValue([
      { name: 'users', columns: new Map([['id', { name: 'id', type: 'integer' }]]) },
    ])

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'sendPrompt', prompt: '@schema how many tables?', includeContext: false })

    const callArg = vi.mocked(mockAgent.run).mock.calls[0][1]
    expect(callArg.fileContent).toContain('@schema')
    expect(callArg.fileContent).toContain('users')
  })

  it('sendPrompt injects @routes context when mentioned', async () => {
    vi.mocked(mockRoutesIndexer.getAllRoutes).mockReturnValue([
      { verb: 'GET', uriPattern: '/users', controller: 'users', action: 'index' },
    ])

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'sendPrompt', prompt: '@routes list', includeContext: false })

    const callArg = vi.mocked(mockAgent.run).mock.calls[0][1]
    expect(callArg.fileContent).toContain('@routes')
    expect(callArg.fileContent).toContain('/users')
  })

  it('sendPrompt injects @file context when mentioned and editor active', async () => {
    const doc = new vscode.TextDocument('/test/workspace/app/models/user.rb', 'ruby', 'class User\nend')
    const editor = { document: doc, selection: new vscode.Selection(0, 0, 0, 0) }
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: editor, configurable: true })

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'sendPrompt', prompt: '@file explain', includeContext: true })

    const callArg = vi.mocked(mockAgent.run).mock.calls[0][1]
    expect(callArg.fileContent).toContain('@file')
    expect(callArg.fileContent).toContain('class User')
  })

  it('sendPrompt injects @patterns context when mentioned', async () => {
    mockPatternNames.mockReturnValue(['CreateService', 'QueryObject'])

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'sendPrompt', prompt: '@patterns available?', includeContext: false })

    const callArg = vi.mocked(mockAgent.run).mock.calls[0][1]
    expect(callArg.fileContent).toContain('@patterns')
    expect(callArg.fileContent).toContain('CreateService')
  })

  it('applyCode in create mode calls createNewFile', async () => {
    mockedCreateFile.mockResolvedValue({ applied: true, message: 'Created app/services/x.rb' })
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined)

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'applyCode', code: 'class Foo\nend', mode: 'create', fileName: 'app/services/foo.rb' })

    expect(mockedCreateFile).toHaveBeenCalledWith('class Foo\nend', '/test/workspace', 'app/services/foo.rb')
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Created app/services/x.rb')
  })

  it('applyCode in create mode does nothing when no workspace root', async () => {
    Object.defineProperty(vscode.workspace, 'workspaceFolders', { value: [], configurable: true })

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'applyCode', code: 'code', mode: 'create' })

    expect(mockedCreateFile).not.toHaveBeenCalled()
  })

  it('applyCode in applyDiff mode calls applyDiffToFile', async () => {
    mockedApplyDiff.mockResolvedValue({ applied: true, message: 'Diff applied' })
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined)

    const doc = new vscode.TextDocument('/test/workspace/app/models/user.rb', 'ruby', 'code')
    const editor = { document: doc, selection: new vscode.Selection(0, 0, 0, 0) }
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: editor, configurable: true })

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'applyCode', code: '@@ -1 +1 @@\n-old\n+new', mode: 'applyDiff' })

    expect(mockedApplyDiff).toHaveBeenCalledWith(
      '@@ -1 +1 @@\n-old\n+new',
      doc.uri,
      'RailsForge AI Diff',
    )
  })

  it('applyCode in applyDiff mode warns when no editor', async () => {
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined)
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: undefined, configurable: true })

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'applyCode', code: 'diff', mode: 'applyDiff' })

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active editor'))
  })

  it('applyCode in replaceFile mode calls applyFullFileReplacement', async () => {
    mockedReplaceFile.mockResolvedValue({ applied: true, message: 'File replaced' })
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined)

    const doc = new vscode.TextDocument('/test/workspace/app/models/user.rb', 'ruby', 'code')
    const editor = { document: doc, selection: new vscode.Selection(0, 0, 0, 0) }
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: editor, configurable: true })

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'applyCode', code: 'class New\nend', mode: 'replaceFile' })

    expect(mockedReplaceFile).toHaveBeenCalledWith(
      'class New\nend',
      doc.uri,
      'RailsForge AI',
    )
  })

  it('applyCode in replaceFile mode warns when no editor', async () => {
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined)
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: undefined, configurable: true })

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'applyCode', code: 'code', mode: 'replaceFile' })

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active editor'))
  })

  it('applyCode in insert mode inserts at cursor', async () => {
    const editFn = vi.fn().mockResolvedValue(true)
    const doc = new vscode.TextDocument('/test/workspace/app/models/user.rb', 'ruby', 'line1\nline2\n')
    const editor = {
      document: doc,
      selection: { isEmpty: true, active: new vscode.Position(1, 0) },
      edit: editFn,
    }
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: editor, configurable: true })
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined)

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'applyCode', code: 'inserted_text', mode: 'insert' })

    expect(editFn).toHaveBeenCalled()
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Code applied to active editor.')
  })

  it('applyCode in replace mode with non-empty selection replaces selection', async () => {
    const editFn = vi.fn((cb: (eb: any) => void) => { cb({ replace: vi.fn() }); return Promise.resolve(true) })
    const doc = new vscode.TextDocument('/test/workspace/app/models/user.rb', 'ruby', 'line1\nline2\n')
    const editor = {
      document: doc,
      selection: { isEmpty: false, active: new vscode.Position(0, 0) },
      edit: editFn,
    }
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: editor, configurable: true })
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined)

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'applyCode', code: 'new_code', mode: 'replace' })

    expect(editFn).toHaveBeenCalled()
  })

  it('applyCode in legacy mode warns when no editor', async () => {
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined)
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: undefined, configurable: true })

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'applyCode', code: 'code', mode: 'insert' })

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active editor'))
  })

  it('sendExternalPrompt focuses view and processes prompt', async () => {
    vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined)
    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await provider.sendExternalPrompt('generate service')

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('railsforge.chatView.focus')
    expect(mockAgent.run).toHaveBeenCalled()
  })

  it('sendPrompt with agent failure logs warning', async () => {
    vi.mocked(mockAgent.run).mockResolvedValue({ success: false, response: 'Model error', iterations: 0 })

    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'sendPrompt', prompt: 'test', includeContext: false })

    const { Logger } = await import('../src/util/Logger')
    expect(Logger.warn).toHaveBeenCalled()
  })

  it('ignores unknown message types', async () => {
    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    // Should not throw
    await wvView.webview.simulateMessage({ type: 'unknownType' })
  })

  it('getHtml contains quick action buttons', () => {
    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    const html = wvView.webview.html
    expect(html).toContain('/service')
    expect(html).toContain('/fix')
    expect(html).toContain('/optimize')
    expect(html).toContain('/migrate')
  })

  it('prompt text cleans @mention tokens before sending to agent', async () => {
    const provider = createProvider()
    const wvView = new vscode.WebviewView()
    provider.resolveWebviewView(wvView)

    await wvView.webview.simulateMessage({ type: 'sendPrompt', prompt: '@schema @routes explain', includeContext: false })

    const callArgs = vi.mocked(mockAgent.run).mock.calls[0]
    expect(callArgs[0]).not.toContain('@schema')
    expect(callArgs[0]).not.toContain('@routes')
  })
})
