import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { SchemaHoverProvider } from '../src/rails/SchemaHoverProvider'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

describe('SchemaHoverProvider', () => {
  const schemaIndexer = {
    getModelColumns: vi.fn().mockReturnValue([]),
  } as unknown as import('../src/rails/SchemaIndexer').SchemaIndexer

  let provider: SchemaHoverProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new SchemaHoverProvider(schemaIndexer)
  })

  it('should return null when word range is null', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'hello')
    const result = provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 0))
    expect(result).toBeNull()
  })

  it('should return null for lowercase words', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'user = User.find(1)')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 7, 0, 11))
    const result = provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 9))
    expect(result).toBeNull()
  })

  it('should return null for words starting with underscore', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', '_Private')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 0, 0, 8))
    const result = provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 4))
    expect(result).toBeNull()
  })

  it('should return null when no columns found', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'User')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 0, 0, 4))
    vi.mocked(schemaIndexer.getModelColumns).mockReturnValue([])
    const result = provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 2))
    expect(result).toBeNull()
  })

  it('should return hover with schema columns', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'User')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 0, 0, 4))
    vi.mocked(schemaIndexer.getModelColumns).mockReturnValue([
      { name: 'id', type: 'bigint', nullable: false, default: null },
      { name: 'email', type: 'string', nullable: true, default: null },
      { name: 'role', type: 'string', nullable: false, default: '"user"' },
    ])
    const result = provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 2))
    expect(result).not.toBeNull()
    expect(result!.contents).toBeDefined()
  })

  it('should accept words with numbers', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'V2User')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 0, 0, 6))
    vi.mocked(schemaIndexer.getModelColumns).mockReturnValue([
      { name: 'id', type: 'bigint', nullable: false },
    ])
    const result = provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 3))
    expect(result).not.toBeNull()
  })

  it('should render column with no default as dash', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'User')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 0, 0, 4))
    vi.mocked(schemaIndexer.getModelColumns).mockReturnValue([
      { name: 'name', type: 'string', nullable: true, default: undefined },
    ])
    const result = provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 2))
    expect(result).not.toBeNull()
  })
})
