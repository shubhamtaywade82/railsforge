import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { RelatedCodeLensProvider } from '../src/graph/RelatedCodeLensProvider'
import type { IndexedPattern, PatternType } from '../src/patterns/ProjectPatternIndexer'
import type { DependencyEdge } from '../src/graph/MinimalDependencyGraph'
import type { ModelRelations } from '../src/graph/RelatedFilesIndex'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

describe('RelatedCodeLensProvider', () => {
  const relatedIndex = {
    getModelRelations: vi.fn(),
    getSpecCount: vi.fn().mockReturnValue(0),
  } as unknown as import('../src/graph/RelatedFilesIndex').RelatedFilesIndex

  const depGraph = {
    getCallers: vi.fn().mockReturnValue([]),
    getCollaborators: vi.fn().mockReturnValue([]),
  } as unknown as import('../src/graph/MinimalDependencyGraph').MinimalDependencyGraph

  const patternIndexer = {
    getAllPatterns: vi.fn().mockReturnValue([]),
    classifyPath: vi.fn().mockReturnValue(null),
    findPatternAt: vi.fn().mockReturnValue(null),
  } as unknown as import('../src/patterns/ProjectPatternIndexer').ProjectPatternIndexer

  let provider: RelatedCodeLensProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new RelatedCodeLensProvider(relatedIndex, depGraph, patternIndexer)
  })

  it('should return empty for non-model, non-pattern files', async () => {
    const doc = new vscode.TextDocument('app/helpers/foo.rb', 'ruby', 'module Foo; end')
    const lenses = await provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(lenses).toEqual([])
  })

  it('should return model lenses for model files', async () => {
    const doc = new vscode.TextDocument('/test/workspace/app/models/user.rb', 'ruby', 'class User < ApplicationRecord\nend')
    const relations: ModelRelations = {
      patternsByType: {
        service: [{ id: '1', type: 'service', name: 'UserService', filePath: '/app/services/user_service.rb', lineStart: 1, publicMethods: ['call'], preview: '' }],
      },
      specCount: 3,
    }
    vi.mocked(relatedIndex.getModelRelations).mockResolvedValue(relations)

    const lenses = await provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(lenses.length).toBe(1)
    expect(lenses[0].command?.title).toContain('1 Service')
    expect(lenses[0].command?.title).toContain('3 Specs')
    expect(lenses[0].command?.command).toBe('railsforge.showRelatedFiles')
  })

  it('should pluralize type labels correctly', async () => {
    const doc = new vscode.TextDocument('/test/workspace/app/models/user.rb', 'ruby', 'class User < ApplicationRecord\nend')
    const relations: ModelRelations = {
      patternsByType: {
        service: [
          { id: '1', type: 'service', name: 'UserService', filePath: '/a', lineStart: 1, publicMethods: [], preview: '' },
          { id: '2', type: 'service', name: 'AdminService', filePath: '/b', lineStart: 1, publicMethods: [], preview: '' },
        ],
        query: [{ id: '3', type: 'query', name: 'UserQuery', filePath: '/c', lineStart: 1, publicMethods: [], preview: '' }],
      },
      specCount: 1,
    }
    vi.mocked(relatedIndex.getModelRelations).mockResolvedValue(relations)

    const lenses = await provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(lenses.length).toBe(1)
    expect(lenses[0].command?.title).toContain('2 Services')
    expect(lenses[0].command?.title).toContain('1 Query')
    expect(lenses[0].command?.title).toContain('1 Spec')
  })

  it('should return empty model lenses when no relations found', async () => {
    const doc = new vscode.TextDocument('app/models/user.rb', 'ruby', 'class User\nend')
    vi.mocked(relatedIndex.getModelRelations).mockResolvedValue({ patternsByType: {}, specCount: 0 })

    const lenses = await provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(lenses).toEqual([])
  })

  it('should return empty model lenses when class definition not found', async () => {
    const doc = new vscode.TextDocument('app/models/user.rb', 'ruby', 'module UserHelper\nend')
    const lenses = await provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(lenses).toEqual([])
  })

  it('should return pattern lenses for service files with callers and collaborators', async () => {
    const code = 'class PaymentService\n  def call\n  end\nend'
    const doc = new vscode.TextDocument('app/services/payment_service.rb', 'ruby', code)
    vi.mocked(patternIndexer.classifyPath).mockReturnValue('service')
    const pattern: IndexedPattern = { id: '1', type: 'service', name: 'PaymentService', filePath: 'app/services/payment_service.rb', lineStart: 1, publicMethods: ['call'], preview: '' }
    vi.mocked(patternIndexer.findPatternAt).mockImplementation((_f, line) => line === 1 ? pattern : null)
    vi.mocked(depGraph.getCallers).mockReturnValue([
      { from: 'InvoicesController', to: 'PaymentService', line: 10, hardCoded: true },
      { from: 'OrdersController', to: 'PaymentService', line: 20, hardCoded: true },
    ])
    vi.mocked(depGraph.getCollaborators).mockReturnValue([
      { from: 'PaymentService', to: 'GatewayClient', line: 5, hardCoded: true },
    ])
    vi.mocked(relatedIndex.getSpecCount).mockReturnValue(2)

    const lenses = await provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(lenses.length).toBe(1)
    expect(lenses[0].command?.title).toContain('Called by 2')
    expect(lenses[0].command?.title).toContain('Depends on 1')
    expect(lenses[0].command?.title).toContain('2 Specs')
  })

  it('should skip lines with no pattern in pattern lenses', async () => {
    const code = 'class PaymentService\n  def call\n  end\nend'
    const doc = new vscode.TextDocument('app/services/payment_service.rb', 'ruby', code)
    vi.mocked(patternIndexer.classifyPath).mockReturnValue('service')
    vi.mocked(patternIndexer.findPatternAt).mockReturnValue(null)
    vi.mocked(depGraph.getCallers).mockReturnValue([])
    vi.mocked(depGraph.getCollaborators).mockReturnValue([])

    const lenses = await provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(lenses).toEqual([])
  })

  it('should skip pattern with no callers/collaborators/specs', async () => {
    const code = 'class PaymentService\n  def call\n  end\nend'
    const doc = new vscode.TextDocument('app/services/payment_service.rb', 'ruby', code)
    vi.mocked(patternIndexer.classifyPath).mockReturnValue('service')
    const pattern: IndexedPattern = { id: '1', type: 'service', name: 'PaymentService', filePath: 'app/services/payment_service.rb', lineStart: 1, publicMethods: ['call'], preview: '' }
    vi.mocked(patternIndexer.findPatternAt).mockImplementation((_f, line) => line === 1 ? pattern : null)
    vi.mocked(depGraph.getCallers).mockReturnValue([])
    vi.mocked(depGraph.getCollaborators).mockReturnValue([])
    vi.mocked(relatedIndex.getSpecCount).mockReturnValue(0)

    const lenses = await provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(lenses).toEqual([])
  })

  it('should skip concerns in model path and use pattern lenses', async () => {
    const doc = new vscode.TextDocument('app/models/concerns/authenticatable.rb', 'ruby', 'module Authenticatable\nend')
    vi.mocked(patternIndexer.classifyPath).mockReturnValue('concern')

    const lenses = await provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(vi.mocked(patternIndexer.classifyPath)).toHaveBeenCalled()
  })

  it('should refresh code lenses', () => {
    expect(() => provider.refresh()).not.toThrow()
  })
})
