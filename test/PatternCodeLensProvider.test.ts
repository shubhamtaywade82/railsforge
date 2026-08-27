import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { PatternCodeLensProvider } from '../src/patterns/PatternCodeLensProvider'
import type { IndexedPattern } from '../src/patterns/ProjectPatternIndexer'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

describe('PatternCodeLensProvider', () => {
  const indexer = {
    classifyPath: vi.fn().mockReturnValue(null),
    findPatternAt: vi.fn().mockReturnValue(null),
    findSimilar: vi.fn().mockReturnValue([]),
  } as unknown as import('../src/patterns/ProjectPatternIndexer').ProjectPatternIndexer

  let provider: PatternCodeLensProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new PatternCodeLensProvider(indexer)
  })

  it('should return empty for non-pattern files', () => {
    const doc = new vscode.TextDocument('app/helpers/foo.rb', 'ruby', 'module Foo; end')
    const lenses = provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(lenses).toEqual([])
  })

  it('should return lenses for patterns with similar matches', () => {
    vi.mocked(indexer.classifyPath).mockReturnValue('service')
    const pattern: IndexedPattern = { id: '1', type: 'service', name: 'PaymentService', filePath: 'app/services/payment_service.rb', lineStart: 1, publicMethods: ['call'], preview: '' }
    vi.mocked(indexer.findPatternAt).mockImplementation((_f, _l) => _l === 1 ? pattern : null)
    vi.mocked(indexer.findSimilar).mockReturnValue([
      { id: '2', type: 'service', name: 'InvoiceService', filePath: 'app/services/invoice_service.rb', lineStart: 1, publicMethods: ['call'], preview: '' },
    ])

    const doc = new vscode.TextDocument('app/services/payment_service.rb', 'ruby', 'class PaymentService\n  def call\n  end\nend')
    const lenses = provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(lenses.length).toBe(1)
    expect(lenses[0].command?.title).toContain('1 similar service')
    expect(lenses[0].command?.command).toBe('railsforge.showSimilarPatterns')
  })

  it('should return empty when no similar patterns found', () => {
    vi.mocked(indexer.classifyPath).mockReturnValue('service')
    const pattern: IndexedPattern = { id: '1', type: 'service', name: 'PaymentService', filePath: 'x', lineStart: 1, publicMethods: [], preview: '' }
    vi.mocked(indexer.findPatternAt).mockImplementation((_f, _l) => _l === 1 ? pattern : null)
    vi.mocked(indexer.findSimilar).mockReturnValue([])

    const doc = new vscode.TextDocument('app/services/payment_service.rb', 'ruby', 'class PaymentService\nend')
    const lenses = provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(lenses).toEqual([])
  })

  it('should refresh code lenses', () => {
    expect(() => provider.refresh()).not.toThrow()
  })
})
