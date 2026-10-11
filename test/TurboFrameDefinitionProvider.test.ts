import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { TurboFrameDefinitionProvider } from '../src/hotwire/TurboFrameDefinitionProvider'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))
vi.mock('../src/hotwire/TurboFrameNavigator', () => ({
  extractFrameIdAtPosition: vi.fn().mockReturnValue(null),
}))

describe('TurboFrameDefinitionProvider', () => {
  const navigator = {
    findFrameLocations: vi.fn().mockReturnValue([]),
  } as unknown as import('../src/hotwire/TurboFrameNavigator').TurboFrameNavigator

  let provider: TurboFrameDefinitionProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new TurboFrameDefinitionProvider(navigator)
  })

  it('should return null when no frame id found', async () => {
    const { extractFrameIdAtPosition } = await import('../src/hotwire/TurboFrameNavigator')
    vi.mocked(extractFrameIdAtPosition).mockReturnValue(null)

    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<div class="foo">')
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 5),
    )
    expect(result).toBeNull()
  })

  it('should return null when no other locations found', async () => {
    const { extractFrameIdAtPosition } = await import('../src/hotwire/TurboFrameNavigator')
    vi.mocked(extractFrameIdAtPosition).mockReturnValue('cart')
    vi.mocked(navigator.findFrameLocations).mockReturnValue([
      { filePath: 'test.html.erb', line: 1 },
    ])

    const doc = new vscode.TextDocument('test.html.erb', 'erb', '')
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 0),
    )
    expect(result).toBeNull()
  })

  it('should return locations for frame in other files', async () => {
    const { extractFrameIdAtPosition } = await import('../src/hotwire/TurboFrameNavigator')
    vi.mocked(extractFrameIdAtPosition).mockReturnValue('cart')
    vi.mocked(navigator.findFrameLocations).mockReturnValue([
      { filePath: '/workspace/app/views/layouts/application.html.erb', line: 5 },
      { filePath: '/workspace/app/views/cart/show.html.erb', line: 10 },
    ])

    const doc = new vscode.TextDocument('test.html.erb', 'erb', '')
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 0),
    )
    expect(result).not.toBeNull()
    expect(Array.isArray(result)).toBe(true)
    expect(result!.length).toBe(2)
  })
})
