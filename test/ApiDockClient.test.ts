import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiDockClient, extractSummary, extractTopNote, type ApiDockLookup } from '../src/docs/ApiDockClient'

const SAMPLE_PAGE = `
<html>
<body>
  <h1>update_attribute</h1>
  <div id="method-description">
    <p>Updates a single attribute and saves the record without going through the normal validation procedure.</p>
  </div>
  <div id="notes">
    <h2>5 Notes</h2>
    <div class="note" id="note-1">
      <div class="meta">Ariejan · Aug 11, 2008</div>
      <p>8 thanks</p>
      <p>Watch out, this skips validations entirely! Use update_attributes instead if you need them.</p>
    </div>
    <div class="note" id="note-2">
      <p>Another less popular note about edge cases.</p>
    </div>
  </div>
  <div id="related-methods">
    <h2>Instance methods</h2>
  </div>
</body>
</html>
`

describe('extractSummary', () => {
  it('extracts and strips the method description', () => {
    expect(extractSummary(SAMPLE_PAGE)).toBe(
      'Updates a single attribute and saves the record without going through the normal validation procedure.',
    )
  })

  it('returns null when no description section is present', () => {
    expect(extractSummary('<html><body>no docs here</body></html>')).toBeNull()
  })

  it('truncates an overly long description', () => {
    const longText = 'a'.repeat(600)
    const html = `<div id="text">${longText}</div><div id="notes"></div>`
    const result = extractSummary(html)
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(501)
    expect(result!.endsWith('…')).toBe(true)
  })

  it('returns null when the extracted text is too short (< 10 chars)', () => {
    const html = `<div id="method-description"><p>short</p></div><div id="notes"></div>`
    expect(extractSummary(html)).toBeNull()
  })

  it('matches class="method_description" start pattern', () => {
    const html = `<div class="method_description"><p>This is a reasonably long method description for testing.</p></div><footer/>`
    const result = extractSummary(html)
    expect(result).toBe('This is a reasonably long method description for testing.')
  })

  it('truncates at <footer> end pattern', () => {
    const html = `<div id="method-description"><p>Good description text here that is long enough.</p></div><footer>Footer stuff</footer>`
    const result = extractSummary(html)
    expect(result).toBe('Good description text here that is long enough.')
  })
})

describe('extractTopNote', () => {
  it('skips vote-count fragments and returns the first real note', () => {
    expect(extractTopNote(SAMPLE_PAGE)).toBe(
      'Watch out, this skips validations entirely! Use update_attributes instead if you need them.',
    )
  })

  it('returns null when there is no notes section', () => {
    expect(extractTopNote('<html><body>no notes</body></html>')).toBeNull()
  })

  it('returns null when all paragraphs are too short or vote fragments', () => {
    const html = `<div id="notes"><p>8 thanks</p><p>12 thanks</p><p>short</p></div><footer/>`
    expect(extractTopNote(html)).toBeNull()
  })

  it('returns null when only vote-count paragraphs exist', () => {
    const html = `<div id="notes"><p>3 thanks</p><p>42 thanks</p></div><footer/>`
    expect(extractTopNote(html)).toBeNull()
  })

  it('truncates a long note to 400 chars with ellipsis', () => {
    const longNote = 'A'.repeat(500)
    const html = `<div id="notes"><p>${longNote}</p></div><footer/>`
    const result = extractTopNote(html)
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(401)
    expect(result!.endsWith('…')).toBe(true)
  })

  it('truncates at <h2>Instance methods end pattern', () => {
    const html = `<div id="notes"><p>This is a note that is long enough to be returned by the function.</p></div><h2>Instance methods</h2><div>more stuff</div>`
    const result = extractTopNote(html)
    expect(result).toBe('This is a note that is long enough to be returned by the function.')
  })
})

describe('ApiDockClient', () => {
  const lookup: ApiDockLookup = { namespace: 'rails', className: 'ActiveRecord/Base', methodName: 'save' }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('constructs with defaults', () => {
    const client = new ApiDockClient()
    expect(client).toBeDefined()
  })

  it('constructs with custom options', () => {
    const client = new ApiDockClient({
      cacheSize: 50,
      cacheTtlMs: 1000,
      timeoutMs: 2000,
      baseUrl: 'https://example.com/apidock/',
    })
    expect(client).toBeDefined()
  })

  it('strips trailing slash from baseUrl', () => {
    const client = new ApiDockClient({ baseUrl: 'https://example.com/apidock/' })
    expect(client).toBeDefined()
  })

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const client = new ApiDockClient({ timeoutMs: 1000 })
    const result = await client.fetchNotes(lookup)
    expect(result).toBeNull()
  })

  it('returns null on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const client = new ApiDockClient({ timeoutMs: 1000 })
    const result = await client.fetchNotes(lookup)
    expect(result).toBeNull()
  })

  it('returns null when no summary or note is found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body>no content</body></html>'),
    }))
    const client = new ApiDockClient({ timeoutMs: 1000 })
    const result = await client.fetchNotes(lookup)
    expect(result).toBeNull()
  })

  it('returns parsed note from successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_PAGE),
    }))
    const client = new ApiDockClient({ timeoutMs: 1000 })
    const result = await client.fetchNotes(lookup)
    expect(result).not.toBeNull()
    expect(result!.summary).toContain('Updates a single attribute')
    expect(result!.topNote).toContain('Watch out')
    expect(result!.url).toContain('ActiveRecord')
  })

  it('serves subsequent requests from cache', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_PAGE),
    })
    vi.stubGlobal('fetch', mockFetch)
    const client = new ApiDockClient({ timeoutMs: 1000, cacheTtlMs: 60000 })

    const first = await client.fetchNotes(lookup)
    expect(first).not.toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const second = await client.fetchNotes(lookup)
    expect(second).toEqual(first)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
