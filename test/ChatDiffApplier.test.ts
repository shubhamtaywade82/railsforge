import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  stat: vi.fn(),
  writeFile: vi.fn(async () => undefined),
  createDirectory: vi.fn(async () => undefined),
  openTextDocument: vi.fn(),
  showTextDocument: vi.fn(async () => ({ selection: undefined, revealRange: () => undefined })),
  showInputBox: vi.fn(),
  showInformationMessage: vi.fn(),
  executeCommand: vi.fn(async () => undefined),
  replace: vi.fn(),
}))

vi.mock('vscode', () => ({
  Uri: { file: (p: string) => ({ scheme: 'file', fsPath: p, path: p, toString: () => `file://${p}` }) },
  workspace: {
    fs: { stat: h.stat, writeFile: h.writeFile, createDirectory: h.createDirectory },
    openTextDocument: h.openTextDocument,
    applyEdit: vi.fn(async () => true),
  },
  window: {
    showTextDocument: h.showTextDocument,
    showInputBox: h.showInputBox,
    showInformationMessage: h.showInformationMessage,
    activeTextEditor: undefined,
  },
  commands: { executeCommand: h.executeCommand },
  WorkspaceEdit: class { replace(...args: unknown[]): void { h.replace(...args) } },
  Range: class {},
  Position: class {},
  Selection: class {},
  TextEditorRevealType: { AtTop: 1 },
}))

import { createNewFile, inferTargetFile, smartApplyResponse } from '../src/chat/ChatDiffApplier'

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-cda-')))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

beforeEach(() => {
  vi.clearAllMocks()
  h.stat.mockRejectedValue(new Error('ENOENT'))
  h.openTextDocument.mockResolvedValue({ uri: { fsPath: 'x' }, getText: () => 'class A\nend\n', languageId: 'ruby', positionAt: () => ({}) })
})

describe('createNewFile', () => {
  it.each(['../evil.rb', 'app/../../evil.rb', '/etc/cron.d/evil', '.git/hooks/pre-commit'])('refuses %s without touching the filesystem', async target => {
    const result = await createNewFile('class Evil; end', root, target)
    expect(result.applied).toBe(false)
    expect(result.message).toMatch(/^Refused to write/)
    expect(h.writeFile).not.toHaveBeenCalled()
    expect(h.createDirectory).not.toHaveBeenCalled()
  })

  it('writes a new file inside the root, creating parent directories, and strips code fences', async () => {
    const result = await createNewFile('```ruby\nclass Greeter\nend\n```', root, 'app/services/greeter.rb')
    expect(result).toEqual({ applied: true, message: 'Created app/services/greeter.rb' })
    expect(h.createDirectory).toHaveBeenCalledOnce()
    const [uri, bytes] = h.writeFile.mock.calls[0] as unknown as [{ fsPath: string }, Buffer]
    expect(uri.fsPath).toBe(path.join(root, 'app', 'services', 'greeter.rb'))
    expect(Buffer.from(bytes).toString('utf8')).toBe('class Greeter\nend\n')
  })

  it('accepts an absolute path already inside the root without joining it twice', async () => {
    const abs = path.join(root, 'app', 'queries', 'q.rb')
    const result = await createNewFile('class Q; end', root, abs)
    expect(result.applied).toBe(true)
    expect((h.writeFile.mock.calls[0] as unknown as [{ fsPath: string }])[0].fsPath).toBe(abs)
  })

  it('never silently overwrites: an existing file goes through the diff preview and honours Discard', async () => {
    h.stat.mockResolvedValue({ type: 1 })
    h.showInformationMessage.mockResolvedValue('Discard')
    const result = await createNewFile('class A\n  def x; end\nend\n', root, 'app/models/a.rb')
    expect(result).toEqual({ applied: false, message: 'Changes discarded.' })
    expect(h.writeFile).not.toHaveBeenCalled()
    expect(h.executeCommand).toHaveBeenCalledWith('vscode.diff', expect.anything(), expect.anything(), expect.any(String))
  })

  it('applies an approved replacement with exactly one trailing newline', async () => {
    h.stat.mockResolvedValue({ type: 1 })
    h.showInformationMessage.mockResolvedValue('Apply Changes')
    const result = await createNewFile('```ruby\nclass A\n  def x; end\nend\n```', root, 'app/models/a.rb')
    expect(result.applied).toBe(true)
    expect(h.replace.mock.calls[0][2]).toBe('class A\n  def x; end\nend\n')
  })

  it('reports identical content for an existing file instead of rewriting it', async () => {
    h.stat.mockResolvedValue({ type: 1 })
    const result = await createNewFile('class A\nend\n', root, 'app/models/a.rb')
    expect(result.applied).toBe(false)
    expect(result.message).toMatch(/identical/)
    expect(h.writeFile).not.toHaveBeenCalled()
  })

  it('prompts for a path when none is given and stops cleanly on cancel', async () => {
    h.showInputBox.mockResolvedValue(undefined)
    expect(await createNewFile('class A; end', root)).toEqual({ applied: false, message: 'No file path provided.' })
    expect(h.writeFile).not.toHaveBeenCalled()
  })
})

describe('inferTargetFile', () => {
  const block = (filePath: string | null, precedingText = '') => ({ lang: 'ruby', filePath, code: '', precedingText })

  it('resolves a fenced-header path inside the root and rejects traversal', () => {
    expect(inferTargetFile(block('app/services/a.rb'), root)).toBe(path.join(root, 'app', 'services', 'a.rb'))
    expect(inferTargetFile(block('../../.ssh/authorized_keys'), root)).toBeNull()
  })

  it('reads "# path.rb" hints from the preceding text, and ignores unsafe ones', () => {
    expect(inferTargetFile(block(null, '# app/models/user.rb\n'), root)).toBe(path.join(root, 'app', 'models', 'user.rb'))
    expect(inferTargetFile(block(null, '# ../outside.rb\n'), root)).toBeNull()
    expect(inferTargetFile(block(null, 'no path here'), root)).toBeNull()
  })
})

describe('smartApplyResponse (create commands)', () => {
  it('falls back to prompting when the model names an unsafe path, instead of writing it', async () => {
    h.showInputBox.mockResolvedValue(undefined)
    const response = '```ruby:../../outside.rb\nclass Outside\nend\n```'
    const result = await smartApplyResponse(response, { workspaceRoot: root, command: 'service' })
    expect(h.showInputBox).toHaveBeenCalledOnce()
    expect(result).toEqual({ applied: false, message: 'No file path provided.' })
    expect(h.writeFile).not.toHaveBeenCalled()
  })

  it('creates the file when the model names a safe path', async () => {
    const response = '```ruby:app/services/ok.rb\nclass Ok\nend\n```'
    const result = await smartApplyResponse(response, { workspaceRoot: root, command: 'service' })
    expect(result).toEqual({ applied: true, message: 'Created app/services/ok.rb' })
  })
})
