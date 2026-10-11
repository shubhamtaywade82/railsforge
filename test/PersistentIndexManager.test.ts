const mocks = vi.hoisted(() => {
  const mockGetSupport = vi.fn(() => ({ supported: true }))
  const mockMissingPrebuilds = vi.fn(() => [] as string[])
  const mockClientCreate = vi.fn()
  const mockIndexFile = vi.fn()
  const mockRemoveFile = vi.fn()
  const mockClientDispose = vi.fn()
  const mockGetDb = vi.fn()
  const mockLoggerWarn = vi.fn()
  const mockLoggerError = vi.fn()
  const mockDepGraph = {}
  const mockDupDetector = {}
  return {
    mockGetSupport,
    mockMissingPrebuilds,
    mockClientCreate,
    mockIndexFile,
    mockRemoveFile,
    mockClientDispose,
    mockGetDb,
    mockLoggerWarn,
    mockLoggerError,
    mockDepGraph,
    mockDupDetector,
  }
})

vi.mock('../src/indexer/nativeSupport', () => ({
  getPersistentIndexSupport: mocks.mockGetSupport,
  missingPrebuilds: mocks.mockMissingPrebuilds,
}))

vi.mock('../src/indexer/PersistentIndexClient', () => ({
  PersistentIndexClient: {
    create: mocks.mockClientCreate,
  },
}))

vi.mock('../src/indexer/PersistentDependencyGraph', () => ({
  PersistentDependencyGraph: vi.fn(function () { return mocks.mockDepGraph }),
}))

vi.mock('../src/indexer/DuplicateMethodDetector', () => ({
  DuplicateMethodDetector: vi.fn(function () { return mocks.mockDupDetector }),
}))

vi.mock('../src/config/RailsForgeConfig', () => ({
  readConfig: () => ({ excludePatterns: [] }),
  buildExcludeGlob: () => '{**/spec/**,**/test/**}',
}))

vi.mock('../src/util/Logger', () => ({
  Logger: { warn: mocks.mockLoggerWarn, error: mocks.mockLoggerError, info: vi.fn(), debug: vi.fn() },
}))

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { PersistentIndexManager } from '../src/indexer/PersistentIndexManager'

describe('PersistentIndexManager', () => {
  const mockClient = {
    indexFile: mocks.mockIndexFile,
    removeFile: mocks.mockRemoveFile,
    dispose: mocks.mockClientDispose,
    getDb: mocks.mockGetDb,
  }

  const mockWatcher = {
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  }

  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockGetSupport.mockReturnValue({ supported: true })
    mocks.mockMissingPrebuilds.mockReturnValue([])
    vscode.workspace.createFileSystemWatcher = vi.fn(() => mockWatcher) as unknown as typeof vscode.workspace.createFileSystemWatcher
    mocks.mockClientCreate.mockResolvedValue(mockClient)
    mocks.mockGetDb.mockReturnValue({})
    mocks.mockIndexFile.mockResolvedValue(undefined)
    mocks.mockRemoveFile.mockResolvedValue(undefined)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns failed when workspaceRoot is empty', async () => {
    const result = await PersistentIndexManager.activate({
      extensionPath: '/ext',
      subscriptions: [] as unknown[],
    } as unknown as vscode.ExtensionContext, '')
    expect(result.status).toBe('failed')
  })

  it('returns unsupported when persistent index is not supported', async () => {
    mocks.mockGetSupport.mockReturnValue({ supported: false, reason: 'N-API too old' })

    const result = await PersistentIndexManager.activate({
      extensionPath: '/ext',
      subscriptions: [] as unknown[],
    } as unknown as vscode.ExtensionContext, '/workspace')

    expect(result).toEqual({ status: 'unsupported', reason: 'N-API too old' })
    expect(mocks.mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('persistent AST index unavailable'),
    )
  })

  it('includes support reason in warning when unsupported', async () => {
    mocks.mockGetSupport.mockReturnValue({ supported: false, reason: 'system GLIBC 2.31 is older than the required 2.33.' })

    await PersistentIndexManager.activate({
      extensionPath: '/ext',
      subscriptions: [] as unknown[],
    } as unknown as vscode.ExtensionContext, '/workspace')

    expect(mocks.mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('GLIBC 2.31'),
    )
  })

  it('returns failed when client creation fails', async () => {
    mocks.mockClientCreate.mockRejectedValue(new Error('worker failed'))

    const result = await PersistentIndexManager.activate({
      extensionPath: '/ext',
      subscriptions: [] as unknown[],
    } as unknown as vscode.ExtensionContext, tmpDir)

    expect(result.status).toBe('failed')
    expect(mocks.mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('persistent AST index failed to start'),
      expect.any(Error),
    )
  })

  it('scans workspace files and sets up watcher on successful activation', async () => {
    const origFindFiles = vscode.workspace.findFiles
    vscode.workspace.findFiles = vi.fn().mockResolvedValue([
      { fsPath: path.join(tmpDir, 'app/models/user.rb') } as unknown as vscode.Uri,
    ])

    fs.mkdirSync(path.join(tmpDir, 'app/models'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'app/models/user.rb'), 'class User; end')

    const result = await PersistentIndexManager.activate({
      extensionPath: '/ext',
      subscriptions: [] as unknown[],
    } as unknown as vscode.ExtensionContext, tmpDir)

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') {return}
    expect(fs.existsSync(path.join(tmpDir, '.railsforge'))).toBe(true)
    expect(mocks.mockClientCreate).toHaveBeenCalledWith(
      path.join('/ext', 'dist', 'indexer', 'indexer.worker.js'),
      path.join(tmpDir, '.railsforge', 'index.sqlite3'),
    )
    expect(mocks.mockIndexFile).toHaveBeenCalledWith(
      path.join(tmpDir, 'app/models/user.rb'),
      'class User; end',
    )
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalled()

    vscode.workspace.findFiles = origFindFiles
  })

  it('skips unreadable files during scan', async () => {
    const origFindFiles = vscode.workspace.findFiles
    const goodFile = path.join(tmpDir, 'app/models/good.rb')
    const badFile = path.join(tmpDir, 'app/models/bad.rb')
    vscode.workspace.findFiles = vi.fn().mockResolvedValue([
      { fsPath: goodFile } as unknown as vscode.Uri,
      { fsPath: badFile } as unknown as vscode.Uri,
    ])

    fs.mkdirSync(path.join(tmpDir, 'app/models'), { recursive: true })
    fs.writeFileSync(goodFile, 'class Good; end')

    const result = await PersistentIndexManager.activate({
      extensionPath: '/ext',
      subscriptions: [] as unknown[],
    } as unknown as vscode.ExtensionContext, tmpDir)

    expect(result.status).toBe('ready')
    expect(mocks.mockIndexFile).toHaveBeenCalledTimes(1)
    expect(mocks.mockIndexFile).toHaveBeenCalledWith(goodFile, 'class Good; end')

    vscode.workspace.findFiles = origFindFiles
  })

  it('disposes the client when dispose is called', async () => {
    const origFindFiles = vscode.workspace.findFiles
    vscode.workspace.findFiles = vi.fn().mockResolvedValue([])

    const result = await PersistentIndexManager.activate({
      extensionPath: '/ext',
      subscriptions: [] as unknown[],
    } as unknown as vscode.ExtensionContext, tmpDir)

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') {return}
    result.manager.dispose()
    expect(mocks.mockClientDispose).toHaveBeenCalled()

    vscode.workspace.findFiles = origFindFiles
  })

  describe('watcher reindex', () => {
    let capturedCallbacks: { onDidChange?: (uri: vscode.Uri) => void; onDidCreate?: (uri: vscode.Uri) => void; onDidDelete?: (uri: vscode.Uri) => void }

    async function activateWithCapturedWatcher(): Promise<PersistentIndexManager> {
      capturedCallbacks = {}
      vscode.workspace.createFileSystemWatcher = vi.fn(() => ({
        onDidChange: vi.fn((cb: (uri: vscode.Uri) => void) => { capturedCallbacks.onDidChange = cb; return { dispose: vi.fn() } }),
        onDidCreate: vi.fn((cb: (uri: vscode.Uri) => void) => { capturedCallbacks.onDidCreate = cb; return { dispose: vi.fn() } }),
        onDidDelete: vi.fn((cb: (uri: vscode.Uri) => void) => { capturedCallbacks.onDidDelete = cb; return { dispose: vi.fn() } }),
        dispose: vi.fn(),
      })) as unknown as typeof vscode.workspace.createFileSystemWatcher

      const origFindFiles = vscode.workspace.findFiles
      vscode.workspace.findFiles = vi.fn().mockResolvedValue([])
      const result = await PersistentIndexManager.activate({
        extensionPath: '/ext',
        subscriptions: [] as unknown[],
      } as unknown as vscode.ExtensionContext, tmpDir)
      vscode.workspace.findFiles = origFindFiles
      expect(result.status).toBe('ready')
      return (result as { status: 'ready'; manager: PersistentIndexManager }).manager
    }

    it('reindexes an existing file when onDidChange fires', async () => {
      const manager = await activateWithCapturedWatcher()
      const filePath = path.join(tmpDir, 'app/models/user.rb')
      fs.mkdirSync(path.join(tmpDir, 'app/models'), { recursive: true })
      fs.writeFileSync(filePath, 'class User; end')

      await capturedCallbacks.onDidChange!(new vscode.Uri(filePath))
      expect(mocks.mockIndexFile).toHaveBeenCalledWith(filePath, 'class User; end')

      manager.dispose()
    })

    it('removes a file when reindex finds the file no longer exists', async () => {
      const manager = await activateWithCapturedWatcher()
      const filePath = path.join(tmpDir, 'app/models/gone.rb')

      await capturedCallbacks.onDidChange!(new vscode.Uri(filePath))
      expect(mocks.mockRemoveFile).toHaveBeenCalledWith(filePath)

      manager.dispose()
    })

    it('removes a file when onDidDelete fires', async () => {
      const manager = await activateWithCapturedWatcher()
      const filePath = path.join(tmpDir, 'app/models/deleted.rb')

      await capturedCallbacks.onDidDelete!(new vscode.Uri(filePath))
      expect(mocks.mockRemoveFile).toHaveBeenCalledWith(filePath)

      manager.dispose()
    })

    it('skips files that throw on read during reindex', async () => {
      const manager = await activateWithCapturedWatcher()
      const filePath = path.join(tmpDir, 'app/models/bad.rb')
      fs.mkdirSync(path.join(tmpDir, 'app/models'), { recursive: true })
      fs.writeFileSync(filePath, 'class Bad; end')
      const origRead = fs.promises.readFile
      fs.promises.readFile = vi.fn().mockRejectedValue(new Error('EACCES')) as typeof fs.promises.readFile

      await capturedCallbacks.onDidChange!(new vscode.Uri(filePath))
      expect(mocks.mockIndexFile).not.toHaveBeenCalled()

      fs.promises.readFile = origRead
      manager.dispose()
    })

    it('reindexes on file creation', async () => {
      const manager = await activateWithCapturedWatcher()
      const filePath = path.join(tmpDir, 'app/models/new.rb')
      fs.mkdirSync(path.join(tmpDir, 'app/models'), { recursive: true })
      fs.writeFileSync(filePath, 'class New; end')

      await capturedCallbacks.onDidCreate!(new vscode.Uri(filePath))
      expect(mocks.mockIndexFile).toHaveBeenCalledWith(filePath, 'class New; end')

      manager.dispose()
    })
  })
})
