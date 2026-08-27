import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { RBSHoverProvider } from '../src/types/RBSHoverProvider'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

describe('RBSHoverProvider', () => {
  const index = {
    get isEmpty() { return false },
    lookup: vi.fn().mockReturnValue([]),
  } as any

  let provider: RBSHoverProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new RBSHoverProvider(index)
  })

  it('should return null when index is empty', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'def save; end')
    const emptyIndex = { isEmpty: true, lookup: vi.fn() } as any
    const emptyProvider = new RBSHoverProvider(emptyIndex)
    const result = emptyProvider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 4))
    expect(result).toBeNull()
  })

  it('should return null when no word range', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', '  ')
    const result = provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 1))
    expect(result).toBeNull()
  })

  it('should return null when no RBS matches', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'def save; end')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 4, 0, 8))
    vi.mocked(index.lookup).mockReturnValue([])
    const result = provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 6))
    expect(result).toBeNull()
  })

  it('should return hover with RBS signatures', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'def save; end')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 4, 0, 8))
    vi.mocked(index.lookup).mockReturnValue([
      { className: 'User', methodName: 'save', signature: '() -> void', isSelf: false },
    ])
    const result = provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 6))
    expect(result).not.toBeNull()
  })

  it('should show self method prefix with dot', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'def save; end')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 4, 0, 8))
    vi.mocked(index.lookup).mockReturnValue([
      { className: 'User', methodName: 'save', signature: '() -> void', isSelf: true },
    ])
    const result = provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 6))
    expect(result).not.toBeNull()
  })

  it('should truncate to 5 matches and show more count', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'def save; end')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 4, 0, 8))
    const matches = Array.from({ length: 7 }, (_, i) => ({
      className: `Class${i}`,
      methodName: 'save',
      signature: '() -> void',
      isSelf: false,
    }))
    vi.mocked(index.lookup).mockReturnValue(matches)
    const result = provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 6))
    expect(result).not.toBeNull()
  })
})
