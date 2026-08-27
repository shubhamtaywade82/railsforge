import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { StimulusCompletionProvider } from '../src/hotwire/StimulusCompletionProvider'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

describe('StimulusCompletionProvider', () => {
  const indexer = {
    getAllControllers: vi.fn().mockReturnValue([]),
    getController: vi.fn().mockReturnValue(null),
  } as unknown as import('../src/hotwire/StimulusIndexer').StimulusIndexer

  let provider: StimulusCompletionProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new StimulusCompletionProvider(indexer)
  })

  it('should return undefined for non-attribute lines', () => {
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<div class="foo">')
    const result = provider.provideCompletionItems(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 20),
    )
    expect(result).toBeUndefined()
  })

  it('should suggest controllers for data-controller attribute', () => {
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<div data-controller="')
    vi.mocked(indexer.getAllControllers).mockReturnValue([
      { identifier: 'hello', filePath: '/app/javascript/controllers/hello_controller.js', actions: [], targets: [] },
    ])
    const result = provider.provideCompletionItems(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 22),
    )
    expect(result).toBeDefined()
    expect(result!.length).toBe(1)
    expect(result![0].label).toBe('hello')
  })

  it('should suggest actions for data-action attribute', () => {
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<div data-action="')
    vi.mocked(indexer.getAllControllers).mockReturnValue([
      { identifier: 'dropdown', filePath: '/app/javascript/controllers/dropdown_controller.js', actions: ['toggle', 'hide'], targets: [] },
    ])
    const result = provider.provideCompletionItems(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 20),
    )
    expect(result).toBeDefined()
    expect(result!.length).toBe(2)
    expect(result![0].insertText).toBe('click->dropdown#toggle')
  })

  it('should suggest targets for data-xxx-target attribute', () => {
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<div data-dropdown-target="')
    vi.mocked(indexer.getController).mockReturnValue({
      identifier: 'dropdown', filePath: '/app/javascript/controllers/dropdown_controller.js', actions: [], targets: ['menu', 'button'],
    })
    const result = provider.provideCompletionItems(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 27),
    )
    expect(result).toBeDefined()
    expect(result!.length).toBe(2)
    expect(result![0].label).toBe('menu')
  })

  it('should return empty array when controller not found for target', () => {
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<div data-unknown-target="')
    vi.mocked(indexer.getController).mockReturnValue(null)
    const result = provider.provideCompletionItems(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 27),
    )
    expect(result).toEqual([])
  })
})
