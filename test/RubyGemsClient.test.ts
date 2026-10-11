import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RubyGemsClient } from '../src/gems/RubyGemsClient'

global.fetch = vi.fn()

describe('RubyGemsClient', () => {
  let client: RubyGemsClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new RubyGemsClient()
  })

  it('should return null on fetch error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'))
    const result = await client.fetchGemInfo('nonexistent-gem-xyz')
    expect(result).toBeNull()
  })

  it('should return null on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response)
    const result = await client.fetchGemInfo('nonexistent')
    expect(result).toBeNull()
  })

  it('should return null on invalid json', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ name: null }) } as unknown as Response)
    const result = await client.fetchGemInfo('bad')
    expect(result).toBeNull()
  })

  it('should parse valid response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        name: 'rails',
        version: '7.1.0',
        summary: 'Ruby on Rails',
        homepage_uri: 'https://rubyonrails.org',
        documentation_uri: 'https://api.rubyonrails.org',
      }),
    } as unknown as Response)

    const result = await client.fetchGemInfo('rails')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('rails')
    expect(result!.version).toBe('7.1.0')
    expect(result!.summary).toBe('Ruby on Rails')
    expect(result!.homepageUri).toBe('https://rubyonrails.org')
    expect(result!.documentationUri).toBe('https://api.rubyonrails.org')
  })

  it('should use cache on second call', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'rails', version: '7.1.0', summary: '' }),
    } as unknown as Response)

    await client.fetchGemInfo('rails')
    await client.fetchGemInfo('rails')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
