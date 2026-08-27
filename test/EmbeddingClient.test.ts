import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EmbeddingClient } from '../src/search/EmbeddingClient'

describe('EmbeddingClient', () => {
  const originalFetch = globalThis.fetch
  let client: EmbeddingClient

  beforeEach(() => {
    client = new EmbeddingClient({ ollamaHost: 'http://localhost:11434', model: 'nomic-embed-text' })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should return embedding on successful response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: [0.1, 0.2, 0.3] }),
    })
    const result = await client.embed('hello world')
    expect(result).toEqual([0.1, 0.2, 0.3])
  })

  it('should return null on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })
    const result = await client.embed('hello')
    expect(result).toBeNull()
  })

  it('should return null when embedding array is empty', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: [] }),
    })
    const result = await client.embed('hello')
    expect(result).toBeNull()
  })

  it('should return null when embedding is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    })
    const result = await client.embed('hello')
    expect(result).toBeNull()
  })

  it('should return null when embedding is not an array', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: 'not-an-array' }),
    })
    const result = await client.embed('hello')
    expect(result).toBeNull()
  })

  it('should return null on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await client.embed('hello')
    expect(result).toBeNull()
  })

  it('should strip trailing slash from ollamaHost', async () => {
    const client2 = new EmbeddingClient({
      ollamaHost: 'http://localhost:11434/',
      model: 'test',
    })
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: [1, 2, 3] }),
    })
    await client2.embed('test')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/embeddings',
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })

  it('should pass correct payload to fetch', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: [0.5] }),
    })
    await client.embed('hello world')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/embeddings',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: 'hello world' }),
      }),
    )
  })

  it('should use default timeout of 5000ms', async () => {
    const client2 = new EmbeddingClient({ ollamaHost: 'http://localhost:11434', model: 'test' })
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: [1] }),
    })
    await client2.embed('test')
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1]).toHaveProperty('signal')
  })
})
