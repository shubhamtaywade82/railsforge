import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RubyDocProvider, parseMethodPage } from '../src/docs/RubyDocProvider'

// Trimmed from a real `curl https://www.rubydoc.info/gems/sidekiq/Sidekiq/Client`
// response — verifies against actual YARD template markup, not a guess at it.
const SIDEKIQ_CLIENT_PAGE = `
<div id="instance_method_details" class="method_details_list">
  <h2>Instance Method Details</h2>

  <div class="method_details first">
  <h3 class="signature first" id="initialize-instance_method">
    <strong>initialize</strong>(pool: nil, config: nil)  &#x21d2; <tt>Client</tt>
  </h3>
  <div class="docstring">
    <div class="discussion">
      <p>Sidekiq::Client is responsible for pushing job payloads to Redis.
Requires the :pool or :config keyword argument.</p>
    </div>
  </div>
  <div class="tags">
    <p class="tag_title">Parameters:</p>
    <ul class="param">
      <li>
        <span class='name'>pool</span>
        <span class='type'>(<tt>ConnectionPool</tt>)</span>
        &mdash;
        <div class='inline'><p>explicit Redis pool to use</p></div>
      </li>
      <li>
        <span class='name'>config</span>
        <span class='type'>(<tt>Sidekiq::Config</tt>)</span>
        &mdash;
        <div class='inline'><p>use the pool and middleware from the given Sidekiq container</p></div>
      </li>
    </ul>
    <p class="tag_title">Returns:</p>
    <ul class="return">
      <li>
        <span class='type'>(<tt>Client</tt>)</span>
        &mdash;
        <div class='inline'><p>a new instance of Client</p></div>
      </li>
    </ul>
  </div>
  <table class="source_code">
    <tr>
      <td><pre class="lines">42\n43</pre></td>
      <td><pre class="code"><span class="info file"># File 'lib/sidekiq/client.rb', line 42</span></pre></td>
    </tr>
  </table>
  </div>

  <div class="method_details ">
  <h3 class="signature " id="push-instance_method">
    <strong>push</strong>(item)  &#x21d2; <tt>String</tt>
  </h3>
  <div class="docstring">
    <div class="discussion">
    </div>
  </div>
  <div class="tags">
  </div>
  </div>
</div>
`

describe('parseMethodPage', () => {
  it('extracts signature, description, params, return type, and source location', () => {
    const entry = parseMethodPage(SIDEKIQ_CLIENT_PAGE, 'sidekiq', '7.2.0', 'Sidekiq::Client', 'initialize', 'https://www.rubydoc.info/gems/sidekiq/7.2.0/Sidekiq/Client')

    expect(entry).not.toBeNull()
    expect(entry!.signature).toContain('initialize(pool: nil, config: nil)')
    expect(entry!.description).toContain('Sidekiq::Client is responsible for pushing job payloads to Redis.')
    expect(entry!.params).toEqual([
      { name: 'pool', type: 'ConnectionPool', description: 'explicit Redis pool to use' },
      { name: 'config', type: 'Sidekiq::Config', description: 'use the pool and middleware from the given Sidekiq container' },
    ])
    expect(entry!.returnType).toBe('Client')
    expect(entry!.sourceLocation).toBe('lib/sidekiq/client.rb:42')
  })

  it('does not bleed content from the next method block', () => {
    const entry = parseMethodPage(SIDEKIQ_CLIENT_PAGE, 'sidekiq', '7.2.0', 'Sidekiq::Client', 'initialize', 'url')
    expect(entry!.description).not.toContain('a new instance of Client')
  })

  it('returns null when the method id is not present on the page', () => {
    const entry = parseMethodPage(SIDEKIQ_CLIENT_PAGE, 'sidekiq', '7.2.0', 'Sidekiq::Client', 'nonexistent_method', 'url')
    expect(entry).toBeNull()
  })

  it('handles a method with no docstring or params gracefully', () => {
    const entry = parseMethodPage(SIDEKIQ_CLIENT_PAGE, 'sidekiq', '7.2.0', 'Sidekiq::Client', 'push', 'url')
    expect(entry).not.toBeNull()
    expect(entry!.description).toBeNull()
    expect(entry!.params).toEqual([])
    expect(entry!.returnType).toBeNull()
  })

  it('handles class_method headings', () => {
    const html = `
    <div class="method_details">
    <h3 id="configure-class_method"><strong>configure</strong>()</h3>
    <div class="docstring"><div class="discussion"><p>Configures the gem.</p></div></div>
    <div class="tags"></div>
    </div>`
    const entry = parseMethodPage(html, 'mygem', '1.0', 'MyGem', 'configure', 'url')
    expect(entry).not.toBeNull()
    expect(entry!.methodName).toBe('configure')
    expect(entry!.description).toBe('Configures the gem.')
  })

  it('truncates a long docstring to 600 chars with ellipsis', () => {
    const longDesc = 'A'.repeat(800)
    const html = `
    <div class="method_details">
    <h3 id="foo-instance_method"><strong>foo</strong>()</h3>
    <div class="docstring"><div class="discussion"><p>${longDesc}</p></div></div>
    <div class="tags"></div>
    </div>`
    const entry = parseMethodPage(html, 'g', '1.0', 'C', 'foo', 'url')
    expect(entry).not.toBeNull()
    expect(entry!.description!.length).toBeLessThanOrEqual(601)
    expect(entry!.description!.endsWith('…')).toBe(true)
  })

  it('handles params with no type span', () => {
    const html = `
    <div class="method_details">
    <h3 id="run-instance_method"><strong>run</strong>()</h3>
    <div class="docstring"><div class="discussion"><p>Runs it.</p></div></div>
    <div class="tags">
      <ul class="param">
        <li>
          <span class='name'>block</span>
          <div class='inline'><p>the block to run</p></div>
        </li>
      </ul>
    </div>
    </div>`
    const entry = parseMethodPage(html, 'g', '1.0', 'C', 'run', 'url')
    expect(entry).not.toBeNull()
    expect(entry!.params).toEqual([{ name: 'block', type: '', description: 'the block to run' }])
  })

  it('handles params with no description div', () => {
    const html = `
    <div class="method_details">
    <h3 id="go-instance_method"><strong>go</strong>()</h3>
    <div class="docstring"><div class="discussion"><p>Go.</p></div></div>
    <div class="tags">
      <ul class="param">
        <li>
          <span class='name'>x</span>
          <span class='type'>(<tt>Integer</tt>)</span>
        </li>
      </ul>
    </div>
    </div>`
    const entry = parseMethodPage(html, 'g', '1.0', 'C', 'go', 'url')
    expect(entry).not.toBeNull()
    expect(entry!.params).toEqual([{ name: 'x', type: 'Integer', description: '' }])
  })

  it('handles return type list with no type span', () => {
    const html = `
    <div class="method_details">
    <h3 id="bar-instance_method"><strong>bar</strong>()</h3>
    <div class="docstring"><div class="discussion"><p>Bar.</p></div></div>
    <div class="tags">
      <ul class="return"><li>no type here</li></ul>
    </div>
    </div>`
    const entry = parseMethodPage(html, 'g', '1.0', 'C', 'bar', 'url')
    expect(entry).not.toBeNull()
    expect(entry!.returnType).toBeNull()
  })

  it('handles method with no source location', () => {
    const html = `
    <div class="method_details">
    <h3 id="baz-instance_method"><strong>baz</strong>()</h3>
    <div class="docstring"><div class="discussion"><p>Baz.</p></div></div>
    <div class="tags"></div>
    </div>`
    const entry = parseMethodPage(html, 'g', '1.0', 'C', 'baz', 'url')
    expect(entry).not.toBeNull()
    expect(entry!.sourceLocation).toBeNull()
  })

  it('strips inline formatting tags from signatures', () => {
    const html = `
    <div class="method_details">
    <h3 id="authorize-instance_method"><strong>authorize</strong>(<em>args</em>)</h3>
    <div class="docstring"><div class="discussion"><p>Auth.</p></div></div>
    <div class="tags"></div>
    </div>`
    const entry = parseMethodPage(html, 'g', '1.0', 'C', 'authorize', 'url')
    expect(entry).not.toBeNull()
    expect(entry!.signature).toContain('authorize(args)')
  })
})

describe('RubyDocProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('constructs with defaults', () => {
    const provider = new RubyDocProvider()
    expect(provider).toBeDefined()
  })

  it('constructs with custom options', () => {
    const provider = new RubyDocProvider({
      cacheSize: 10,
      cacheTtlMs: 500,
      timeoutMs: 1000,
      baseUrl: 'https://example.com/docs/',
    })
    expect(provider).toBeDefined()
  })

  it('returns null on network error for versioned URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')))
    const provider = new RubyDocProvider({ timeoutMs: 1000 })
    const result = await provider.fetchMethod('nonexistent', '1.0', 'Foo', 'bar')
    expect(result).toBeNull()
  })

  it('returns null on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const provider = new RubyDocProvider({ timeoutMs: 1000 })
    const result = await provider.fetchMethod('missing', '1.0', 'Foo', 'bar')
    expect(result).toBeNull()
  })

  it('fetches and parses a method page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SIDEKIQ_CLIENT_PAGE),
    }))
    const provider = new RubyDocProvider({ timeoutMs: 1000 })
    const result = await provider.fetchMethod('sidekiq', '7.2.0', 'Sidekiq::Client', 'initialize')
    expect(result).not.toBeNull()
    expect(result!.signature).toContain('initialize')
    expect(result!.description).toContain('Sidekiq::Client')
  })

  it('falls back to unversioned URL when versioned returns non-ok', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(SIDEKIQ_CLIENT_PAGE),
      })
    vi.stubGlobal('fetch', mockFetch)
    const provider = new RubyDocProvider({ timeoutMs: 1000 })
    const result = await provider.fetchMethod('sidekiq', '7.2.0', 'Sidekiq::Client', 'initialize')
    expect(result).not.toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('caches successful responses', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SIDEKIQ_CLIENT_PAGE),
    })
    vi.stubGlobal('fetch', mockFetch)
    const provider = new RubyDocProvider({ timeoutMs: 1000, cacheTtlMs: 60000 })

    const first = await provider.fetchMethod('sidekiq', '7.2.0', 'Sidekiq::Client', 'initialize')
    expect(first).not.toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const second = await provider.fetchMethod('sidekiq', '7.2.0', 'Sidekiq::Client', 'initialize')
    expect(second).toEqual(first)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('returns null when HTML has no matching method heading', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body>no method here</body></html>'),
    }))
    const provider = new RubyDocProvider({ timeoutMs: 1000 })
    const result = await provider.fetchMethod('sidekiq', '7.2.0', 'Sidekiq::Client', 'nonexistent')
    expect(result).toBeNull()
  })

  it('replaces :: in className with / for URL construction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SIDEKIQ_CLIENT_PAGE),
    }))
    const provider = new RubyDocProvider({ timeoutMs: 1000 })
    await provider.fetchMethod('sidekiq', '7.2.0', 'Sidekiq::Client', 'initialize')
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('Sidekiq/Client')
  })
})
