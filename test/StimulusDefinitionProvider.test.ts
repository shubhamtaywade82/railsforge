import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { StimulusDefinitionProvider } from '../src/hotwire/StimulusDefinitionProvider'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))
vi.mock('../src/hotwire/StimulusAttributeParser', () => ({
  matchActionAtPosition: vi.fn().mockReturnValue(null),
  matchControllerIdentifierAtPosition: vi.fn().mockReturnValue(null),
}))

describe('StimulusDefinitionProvider', () => {
  const indexer = {
    getController: vi.fn().mockReturnValue(null),
  } as unknown as import('../src/hotwire/StimulusIndexer').StimulusIndexer

  let provider: StimulusDefinitionProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new StimulusDefinitionProvider(indexer)
  })

  it('should return null when no action or controller matched', () => {
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<div class="foo">')
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 5),
    )
    expect(result).toBeNull()
  })

  it('should return null when controller not found for action', async () => {
    const { matchActionAtPosition } = await import('../src/hotwire/StimulusAttributeParser')
    vi.mocked(matchActionAtPosition).mockReturnValue({ identifier: 'hello', action: 'greet' })
    vi.mocked(indexer.getController).mockReturnValue(null)

    const doc = new vscode.TextDocument('test.html.erb', 'erb', '')
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 0),
    )
    expect(result).toBeNull()
  })

  it('should return location for action definition', async () => {
    const { matchActionAtPosition } = await import('../src/hotwire/StimulusAttributeParser')
    vi.mocked(matchActionAtPosition).mockReturnValue({ identifier: 'hello', action: 'greet' })
    vi.mocked(indexer.getController).mockReturnValue({
      identifier: 'hello',
      filePath: '/app/javascript/controllers/hello_controller.js',
      actionLines: { greet: 10 },
    })

    const doc = new vscode.TextDocument('test.html.erb', 'erb', '')
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 0),
    )
    expect(result).not.toBeNull()
  })

  it('should return location for controller identifier definition', async () => {
    const { matchActionAtPosition, matchControllerIdentifierAtPosition } = await import('../src/hotwire/StimulusAttributeParser')
    vi.mocked(matchActionAtPosition).mockReturnValue(null)
    vi.mocked(matchControllerIdentifierAtPosition).mockReturnValue('hello')
    vi.mocked(indexer.getController).mockReturnValue({
      identifier: 'hello',
      filePath: '/app/javascript/controllers/hello_controller.js',
      actionLines: {},
    })

    const doc = new vscode.TextDocument('test.html.erb', 'erb', '')
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 0),
    )
    expect(result).not.toBeNull()
  })

  it('should return location at line 0 when actionLine is undefined', async () => {
    const { matchActionAtPosition } = await import('../src/hotwire/StimulusAttributeParser')
    vi.mocked(matchActionAtPosition).mockReturnValue({ identifier: 'hello', action: 'greet' })
    vi.mocked(indexer.getController).mockReturnValue({
      identifier: 'hello',
      filePath: '/app/javascript/controllers/hello_controller.js',
      actionLines: {},
    })

    const doc = new vscode.TextDocument('test.html.erb', 'erb', '')
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 0),
    )
    expect(result).not.toBeNull()
    const loc = result as vscode.Location
    const pos = loc.range as unknown as vscode.Position
    expect(pos.line).toBe(0)
    expect(pos.character).toBe(0)
  })

  it('should return null when controller not found for identifier', async () => {
    const { matchActionAtPosition, matchControllerIdentifierAtPosition } = await import('../src/hotwire/StimulusAttributeParser')
    vi.mocked(matchActionAtPosition).mockReturnValue(null)
    vi.mocked(matchControllerIdentifierAtPosition).mockReturnValue('unknown')
    vi.mocked(indexer.getController).mockReturnValue(null)

    const doc = new vscode.TextDocument('test.html.erb', 'erb', '')
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 0),
    )
    expect(result).toBeNull()
  })
})
