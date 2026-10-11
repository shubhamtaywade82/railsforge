import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { GemLensProvider } from '../src/gems/GemLensProvider'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))
vi.mock('../src/gems/GemNameParser', () => ({
  extractGemNameAtPosition: vi.fn().mockReturnValue(null),
}))

describe('GemLensProvider', () => {
  const client = {
    fetchGemInfo: vi.fn(),
  } as unknown as import('../src/gems/RubyGemsClient').RubyGemsClient

  let provider: GemLensProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new GemLensProvider(client)
  })

  it('should return null for non-Gemfile', async () => {
    const doc = new vscode.TextDocument('app/models/user.rb', 'ruby', "gem 'rails'")
    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 0))
    expect(result).toBeNull()
  })

  it('should return null when no gem name found', async () => {
    const doc = new vscode.TextDocument('Gemfile', 'ruby', 'source "https://rubygems.org"')
    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 0))
    expect(result).toBeNull()
  })

  it('should return null when gem info not available', async () => {
    const doc = new vscode.TextDocument('Gemfile', 'ruby', "gem 'rails'")
    const { extractGemNameAtPosition } = await import('../src/gems/GemNameParser')
    vi.mocked(extractGemNameAtPosition).mockReturnValue('rails')
    vi.mocked(client.fetchGemInfo).mockResolvedValue(null)

    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 0))
    expect(result).toBeNull()
  })

  it('should return hover with gem info including links', async () => {
    const doc = new vscode.TextDocument('Gemfile', 'ruby', "gem 'rails'")
    const { extractGemNameAtPosition } = await import('../src/gems/GemNameParser')
    vi.mocked(extractGemNameAtPosition).mockReturnValue('rails')
    vi.mocked(client.fetchGemInfo).mockResolvedValue({
      name: 'rails',
      version: '7.1.0',
      summary: 'Ruby on Rails',
      homepageUri: 'https://rubyonrails.org',
      documentationUri: 'https://api.rubyonrails.org',
    })

    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 6))
    expect(result).not.toBeNull()
  })

  it('should return hover with gem info without links', async () => {
    const doc = new vscode.TextDocument('Gemfile', 'ruby', "gem 'minitest'")
    const { extractGemNameAtPosition } = await import('../src/gems/GemNameParser')
    vi.mocked(extractGemNameAtPosition).mockReturnValue('minitest')
    vi.mocked(client.fetchGemInfo).mockResolvedValue({
      name: 'minitest',
      version: '5.20.0',
      summary: '',
    })

    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 6))
    expect(result).not.toBeNull()
  })

  it('should return hover with only documentation link', async () => {
    const doc = new vscode.TextDocument('Gemfile', 'ruby', "gem 'pg'")
    const { extractGemNameAtPosition } = await import('../src/gems/GemNameParser')
    vi.mocked(extractGemNameAtPosition).mockReturnValue('pg')
    vi.mocked(client.fetchGemInfo).mockResolvedValue({
      name: 'pg',
      version: '1.5.0',
      summary: 'PostgreSQL client',
      documentationUri: 'https://deveiate.org/code/pg',
    })

    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 6))
    expect(result).not.toBeNull()
  })

  it('should return hover with only homepage link', async () => {
    const doc = new vscode.TextDocument('Gemfile', 'ruby', "gem 'puma'")
    const { extractGemNameAtPosition } = await import('../src/gems/GemNameParser')
    vi.mocked(extractGemNameAtPosition).mockReturnValue('puma')
    vi.mocked(client.fetchGemInfo).mockResolvedValue({
      name: 'puma',
      version: '6.0.0',
      summary: 'A Ruby web server',
      homepageUri: 'https://puma.io',
    })

    const result = await provider.provideHover(doc as unknown as vscode.TextDocument, new vscode.Position(0, 6))
    expect(result).not.toBeNull()
  })
})
