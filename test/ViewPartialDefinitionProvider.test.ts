import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { ViewPartialDefinitionProvider } from '../src/rails/ViewPartialDefinitionProvider'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

describe('ViewPartialDefinitionProvider', () => {
  const resolver = {
    resolvePartialPath: vi.fn().mockReturnValue(null),
  } as unknown as import('../src/rails/ViewPartialResolver').ViewPartialResolver

  let provider: ViewPartialDefinitionProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new ViewPartialDefinitionProvider(resolver)
  })

  it('should return null when no workspace folder', () => {
    const origFolders = vscode.workspace.workspaceFolders
    vscode.workspace.workspaceFolders = []
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<%= render "shared/navbar" %>')
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 0),
    )
    expect(result).toBeNull()
    vscode.workspace.workspaceFolders = origFolders
  })

  it('should return null when no render path found at position', () => {
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<div>hello</div>')
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 5),
    )
    expect(result).toBeNull()
  })

  it('should return null when resolver returns null', () => {
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<%= render "shared/navbar" %>')
    vi.mocked(resolver.resolvePartialPath).mockReturnValue(null)
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 15),
    )
    expect(result).toBeNull()
  })

  it('should return location when partial resolved', () => {
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<%= render "shared/navbar" %>')
    vi.mocked(resolver.resolvePartialPath).mockReturnValue('/workspace/app/views/shared/_navbar.html.erb')
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 20),
    )
    expect(result).not.toBeNull()
    expect((result as vscode.Location).uri.fsPath).toBe('/workspace/app/views/shared/_navbar.html.erb')
  })

  it('should handle render partial: syntax', () => {
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<%= render partial: "users/card" %>')
    vi.mocked(resolver.resolvePartialPath).mockReturnValue('/workspace/app/views/users/_card.html.erb')
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 25),
    )
    expect(result).not.toBeNull()
    expect((result as vscode.Location).uri.fsPath).toContain('_card.html.erb')
  })

  it('should handle render with parentheses syntax', () => {
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<%= render("shared/sidebar") %>')
    vi.mocked(resolver.resolvePartialPath).mockReturnValue('/workspace/app/views/shared/_sidebar.html.erb')
    const result = provider.provideDefinition(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 20),
    )
    expect(result).not.toBeNull()
  })
})
