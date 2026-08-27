import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { RelatedHoverProvider } from '../src/graph/RelatedHoverProvider'
import type { DependencyEdge } from '../src/graph/MinimalDependencyGraph'
import type { IndexedPattern } from '../src/patterns/ProjectPatternIndexer'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

describe('RelatedHoverProvider', () => {
  const relatedIndex = {
    getSpecCount: vi.fn().mockReturnValue(0),
    getModelRelations: vi.fn(),
  } as unknown as import('../src/graph/RelatedFilesIndex').RelatedFilesIndex

  const depGraph = {
    getCallers: vi.fn().mockReturnValue([]),
    getCollaborators: vi.fn().mockReturnValue([]),
  } as unknown as import('../src/graph/MinimalDependencyGraph').MinimalDependencyGraph

  const patternIndexer = {
    getAllPatterns: vi.fn().mockReturnValue([]),
  } as unknown as import('../src/patterns/ProjectPatternIndexer').ProjectPatternIndexer

  let provider: RelatedHoverProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new RelatedHoverProvider(relatedIndex, depGraph, patternIndexer)
  })

  it('should return null when word range is null', async () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'hello world')
    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 0))
    expect(result).toBeNull()
  })

  it('should return null for lowercase words', async () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'hello')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 0, 0, 5))
    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 2))
    expect(result).toBeNull()
  })

  it('should return null for words not starting with uppercase', async () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', '_Private')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 0, 0, 8))
    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 4))
    expect(result).toBeNull()
  })

  it('should return null when not on a class definition line', async () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'class Foo\n  bar = Baz.new')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(1, 8, 1, 11))
    vi.spyOn(doc, 'lineAt').mockReturnValue(new vscode.TextLine('  bar = Baz.new'))
    vi.mocked(patternIndexer.getAllPatterns).mockReturnValue([])
    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(1, 9))
    expect(result).toBeNull()
  })

  it('should return hover for known pattern with callers', async () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'class PaymentService\nend')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 6, 0, 22))
    vi.mocked(patternIndexer.getAllPatterns).mockReturnValue([
      { id: '1', type: 'service', name: 'PaymentService', filePath: 'test.rb', lineStart: 1, publicMethods: ['call'], preview: '' },
    ])
    vi.mocked(depGraph.getCallers).mockReturnValue([
      { from: 'InvoicesController', to: 'PaymentService', line: 10, hardCoded: true },
      { from: 'OrdersController', to: 'PaymentService', line: 20, hardCoded: true },
    ])
    vi.mocked(relatedIndex.getSpecCount).mockReturnValue(3)

    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 10))
    expect(result).not.toBeNull()
    expect(result!.contents).toBeDefined()
  })

  it('should return hover for known pattern with collaborators', async () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'class PaymentService\nend')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 6, 0, 22))
    vi.mocked(patternIndexer.getAllPatterns).mockReturnValue([
      { id: '1', type: 'service', name: 'PaymentService', filePath: 'test.rb', lineStart: 1, publicMethods: ['call'], preview: '' },
    ])
    vi.mocked(depGraph.getCallers).mockReturnValue([])
    vi.mocked(depGraph.getCollaborators).mockReturnValue([
      { from: 'PaymentService', to: 'GatewayClient', line: 5, hardCoded: true },
      { from: 'PaymentService', to: 'EmailClient', line: 7, hardCoded: true },
    ])
    vi.mocked(relatedIndex.getSpecCount).mockReturnValue(0)

    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 10))
    expect(result).not.toBeNull()
  })

  it('should return hover for unknown model on class line', async () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'class User\nend')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 6, 0, 10))
    vi.mocked(patternIndexer.getAllPatterns).mockReturnValue([])
    vi.mocked(relatedIndex.getModelRelations).mockResolvedValue({
      patternsByType: {
        service: [{ id: '1', type: 'service', name: 'UserService', filePath: 'x', lineStart: 1, publicMethods: [], preview: '' }],
        query: [{ id: '2', type: 'query', name: 'UserSearch', filePath: 'y', lineStart: 1, publicMethods: [], preview: '' }],
      },
      specCount: 2,
    })

    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 8))
    expect(result).not.toBeNull()
  })

  it('should return null for model with no relations and no specs', async () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'class User\nend')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 6, 0, 10))
    vi.mocked(patternIndexer.getAllPatterns).mockReturnValue([])
    vi.mocked(relatedIndex.getModelRelations).mockResolvedValue({
      patternsByType: {},
      specCount: 0,
    })

    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 8))
    expect(result).toBeNull()
  })

  it('should return null when pattern has no callers/collaborators/specs', async () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'class EmptyService\nend')
    vi.spyOn(doc, 'getWordRangeAtPosition').mockReturnValue(new vscode.Range(0, 6, 0, 19))
    vi.mocked(patternIndexer.getAllPatterns).mockReturnValue([
      { id: '1', type: 'service', name: 'EmptyService', filePath: 'test.rb', lineStart: 1, publicMethods: [], preview: '' },
    ])
    vi.mocked(depGraph.getCallers).mockReturnValue([])
    vi.mocked(depGraph.getCollaborators).mockReturnValue([])
    vi.mocked(relatedIndex.getSpecCount).mockReturnValue(0)

    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 10))
    expect(result).toBeNull()
  })
})
