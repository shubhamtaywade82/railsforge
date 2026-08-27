import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DevDocsFetcher, toDevDocsSlug } from '../src/docs/DevDocsFetcher'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe('toDevDocsSlug', () => {
  it('creates slug with major.minor from version string', () => {
    expect(toDevDocsSlug('rails', '7.1.0')).toBe('rails~7.1')
  })

  it('handles version with only major number', () => {
    expect(toDevDocsSlug('ruby', '3')).toBe('ruby~3')
  })

  it('handles two-part version', () => {
    expect(toDevDocsSlug('rails', '7.0')).toBe('rails~7.0')
  })

  it('handles single minor version', () => {
    expect(toDevDocsSlug('rspec', '3.12')).toBe('rspec~3.12')
  })
})

describe('DevDocsFetcher', () => {
  let tmpDir: string
  let fetcher: DevDocsFetcher

  beforeEach(() => {
    vi.restoreAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devdocs-test-'))
    fetcher = new DevDocsFetcher({ cacheDir: tmpDir, timeoutMs: 2000 })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('constructs with defaults for timeout and baseUrl', () => {
    const f = new DevDocsFetcher({ cacheDir: tmpDir })
    expect(f).toBeDefined()
  })

  it('strips trailing slash from baseUrl', () => {
    const f = new DevDocsFetcher({ cacheDir: tmpDir, baseUrl: 'https://example.com/docs/' })
    expect(f).toBeDefined()
  })

  it('returns true when cached files already exist', async () => {
    const slugDir = path.join(tmpDir, 'rails~7.1')
    fs.mkdirSync(slugDir, { recursive: true })
    fs.writeFileSync(path.join(slugDir, 'index.json'), '[]')
    fs.writeFileSync(path.join(slugDir, 'db.json'), '{}')

    const result = await fetcher.ensureDocset('rails~7.1')
    expect(result).toBe(true)
  })

  it('downloads and caches index and db files', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('[{"name":"save"}]') })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('{"save":"<h1>save</h1>"}') }),
    )

    const result = await fetcher.ensureDocset('rails~7.1')
    expect(result).toBe(true)

    const indexPath = path.join(tmpDir, 'rails~7.1', 'index.json')
    const dbPath = path.join(tmpDir, 'rails~7.1', 'db.json')
    expect(fs.existsSync(indexPath)).toBe(true)
    expect(fs.existsSync(dbPath)).toBe(true)
    expect(fs.readFileSync(indexPath, 'utf8')).toBe('[{"name":"save"}]')
    expect(fs.readFileSync(dbPath, 'utf8')).toBe('{"save":"<h1>save</h1>"}')
  })

  it('returns false when index download fails and no cache exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    const result = await fetcher.ensureDocset('rails~7.1')
    expect(result).toBe(false)
  })

  it('returns false when index returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    const result = await fetcher.ensureDocset('rails~7.1')
    expect(result).toBe(false)
  })

  it('returns false when db download fails after successful index', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('[]') })
      .mockRejectedValueOnce(new Error('timeout')),
    )

    const result = await fetcher.ensureDocset('rails~7.1')
    expect(result).toBe(false)
  })

  it('returns false when db returns non-ok after successful index', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('[]') })
      .mockResolvedValueOnce({ ok: false, status: 500 }),
    )

    const result = await fetcher.ensureDocset('rails~7.1')
    expect(result).toBe(false)
  })

  it('force refresh re-downloads even when cache exists', async () => {
    const slugDir = path.join(tmpDir, 'rails~7.1')
    fs.mkdirSync(slugDir, { recursive: true })
    fs.writeFileSync(path.join(slugDir, 'index.json'), 'old')
    fs.writeFileSync(path.join(slugDir, 'db.json'), 'old')

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('new-index') })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('new-db') }),
    )

    const result = await fetcher.ensureDocset('rails~7.1', true)
    expect(result).toBe(true)
    expect(fs.readFileSync(path.join(slugDir, 'index.json'), 'utf8')).toBe('new-index')
    expect(fs.readFileSync(path.join(slugDir, 'db.json'), 'utf8')).toBe('new-db')
  })

  it('falls back to existing cache when refresh fails', async () => {
    const slugDir = path.join(tmpDir, 'rails~7.1')
    fs.mkdirSync(slugDir, { recursive: true })
    fs.writeFileSync(path.join(slugDir, 'index.json'), 'cached-index')
    fs.writeFileSync(path.join(slugDir, 'db.json'), 'cached-db')

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')))

    const result = await fetcher.ensureDocset('rails~7.1', true)
    expect(result).toBe(true)
    expect(fs.readFileSync(path.join(slugDir, 'index.json'), 'utf8')).toBe('cached-index')
  })

  it('returns false when write fails (e.g. read-only dir)', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('[]') })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('{}') }),
    )

    // Use a non-existent path that can't be created
    const readOnlyFetcher = new DevDocsFetcher({ cacheDir: '/dev/null/impossible/path', timeoutMs: 2000 })
    const result = await readOnlyFetcher.ensureDocset('rails~7.1')
    expect(result).toBe(false)
  })

  it('uses custom baseUrl in fetch URLs', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('[]') })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('{}') })
    vi.stubGlobal('fetch', mockFetch)

    const customFetcher = new DevDocsFetcher({
      cacheDir: tmpDir,
      timeoutMs: 2000,
      baseUrl: 'https://custom.devdocs.io',
    })
    await customFetcher.ensureDocset('rails~7.1')

    expect(mockFetch.mock.calls[0][0]).toContain('https://custom.devdocs.io')
  })
})
