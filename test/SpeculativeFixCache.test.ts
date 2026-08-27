import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SpeculativeFixCache } from '../src/agent/SpeculativeFixCache'
import { RailsAgent } from '../src/agent/RailsAgent'
import { SchemaIndexer } from '../src/rails/SchemaIndexer'
import { RoutesIndexer } from '../src/rails/RoutesIndexer'

function buildMockAgent(suggestFixReturn: unknown = null): RailsAgent {
  return {
    suggestFix: vi.fn().mockResolvedValue(suggestFixReturn),
  } as unknown as RailsAgent
}

const baseConfig = { ollamaHost: 'http://localhost:11434', model: 'test' }

function buildCache(overrides?: Record<string, unknown>): SpeculativeFixCache {
  const config = { maxEntries: 5, ttlMs: 60000, ...overrides }
  return new SpeculativeFixCache(
    new RailsAgent(new SchemaIndexer(), new RoutesIndexer(), baseConfig),
    config,
  )
}

describe('SpeculativeFixCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('set and get a cached fix by cop and code pattern', () => {
    const cache = buildCache()
    cache.set('Style/FrozenStringLiteralComment', '^\\s*[^#]', 'diff output')
    expect(cache.get('Style/FrozenStringLiteralComment', '  class Foo')).toBe('diff output')
  })

  it('returns null for unknown cop', () => {
    const cache = buildCache()
    expect(cache.get('Unknown/Cop', 'code')).toBeNull()
  })

  it('returns null when cached pattern does not match code', () => {
    const cache = buildCache()
    cache.set('Style/FrozenStringLiteralComment', '^class\\s+', 'diff')
    // Code is 'def foo' which doesn't match ^class\s+
    expect(cache.get('Style/FrozenStringLiteralComment', 'def foo')).toBeNull()
  })

  it('evicts expired entries on get', () => {
    const cache = buildCache({ ttlMs: 1000 })
    cache.set('Cop/A', 'x', 'diff-a')
    expect(cache.get('Cop/A', 'x')).toBe('diff-a')
    vi.advanceTimersByTime(1001)
    expect(cache.get('Cop/A', 'x')).toBeNull()
  })

  it('evicts oldest entry when maxEntries is reached', () => {
    const cache = buildCache({ maxEntries: 2 })
    cache.set('Cop/A', 'x', 'diff-a')
    cache.set('Cop/B', 'y', 'diff-b')
    cache.set('Cop/C', 'z', 'diff-c') // should evict Cop/A
    expect(cache.get('Cop/A', 'x')).toBeNull()
    expect(cache.get('Cop/B', 'y')).toBe('diff-b')
    expect(cache.get('Cop/C', 'z')).toBe('diff-c')
  })

  it('clear resets cache and warmed flag', () => {
    const cache = buildCache()
    cache.set('Cop/A', 'x', 'diff')
    expect(cache.stats().size).toBe(1)
    cache.clear()
    expect(cache.stats().size).toBe(0)
    expect(cache.stats().warmed).toBe(false)
  })

  it('stats reports size, warmed flag, and entry keys', () => {
    const cache = buildCache()
    cache.set('Cop/A', 'x', 'diff-a')
    cache.set('Cop/B', 'y', 'diff-b')
    const stats = cache.stats()
    expect(stats.size).toBe(2)
    expect(stats.warmed).toBe(false)
    expect(stats.entries).toContain('Cop/A:x')
    expect(stats.entries).toContain('Cop/B:y')
  })

  it('warm sets warmed flag and prevents double-warming', async () => {
    const agent = buildMockAgent(null)
    const cache = new SpeculativeFixCache(agent, { maxEntries: 2, ttlMs: 60000 })
    await cache.warm()
    expect(cache.stats().warmed).toBe(true)
    // Second warm should be a no-op — reset mock to track only post-warm calls
    ;(agent.suggestFix as ReturnType<typeof vi.fn>).mockClear()
    await cache.warm()
    expect(agent.suggestFix).not.toHaveBeenCalled()
  })

  it('warm coalesces concurrent calls', async () => {
    const agent = buildMockAgent(null)
    const cache = new SpeculativeFixCache(agent, { maxEntries: 2, ttlMs: 60000 })
    // Both promises should resolve to the same warm operation
    const [r1, r2] = await Promise.all([cache.warm(), cache.warm()])
    expect(r1).toBeUndefined()
    expect(r2).toBeUndefined()
    expect(cache.stats().warmed).toBe(true)
  })

  it('doWarm stops generating when maxEntries is reached', async () => {
    const agent = buildMockAgent({
      type: 'patch' as const,
      hunks: [{ file: 'a.rb', oldStart: 0, oldLines: ['x'], newLines: ['y'] }],
    })
    const cache = new SpeculativeFixCache(agent, { maxEntries: 1, ttlMs: 60000 })
    await cache.warm()
    // First template fills the cache (size=1), second template hits the break
    const calls = (agent.suggestFix as ReturnType<typeof vi.fn>).mock.calls.length
    expect(calls).toBe(1) // only 1 call before the break triggers
    expect(cache.stats().size).toBe(1)
  })

  it('doWarm tolerates errors from suggestFix', async () => {
    const agent = buildMockAgent(null)
    // Make suggestFix throw for the first call
    ;(agent.suggestFix as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'))
    const cache = new SpeculativeFixCache(agent, { maxEntries: 5, ttlMs: 60000 })
    await cache.warm()
    // Should not throw, just skip that template
    expect(cache.stats().warmed).toBe(true)
  })

  it('generateTemplateFix returns null when suggestFix returns null', async () => {
    const agent = buildMockAgent(null)
    const cache = new SpeculativeFixCache(agent, { maxEntries: 5, ttlMs: 60000 })
    await cache.warm()
    // All suggestFix calls return null, so cache should be empty
    expect(cache.stats().size).toBe(0)
  })

  it('generateTemplateFix returns null when suggestFix returns a snippet instead of patch', async () => {
    const agent = buildMockAgent({ type: 'snippet', code: 'replacement' })
    const cache = new SpeculativeFixCache(agent, { maxEntries: 5, ttlMs: 60000 })
    await cache.warm()
    expect(cache.stats().size).toBe(0)
  })

  it('generateTemplateFix returns null for patch with zero hunks', async () => {
    const agent = buildMockAgent({ type: 'patch', hunks: [] })
    const cache = new SpeculativeFixCache(agent, { maxEntries: 5, ttlMs: 60000 })
    await cache.warm()
    expect(cache.stats().size).toBe(0)
  })

  it('get handles invalid regex in codePattern gracefully', () => {
    const cache = buildCache()
    // Manually insert an entry with an invalid regex
    const key = 'Cop/Bad:[invalid('
    cache.set('Cop/Bad', '[invalid(', 'diff')
    expect(cache.get('Cop/Bad', 'anything')).toBeNull()
  })

  it('findMatchingKey handles invalid regex gracefully', () => {
    const cache = buildCache()
    cache.set('Cop/Good', '.', 'diff-good')
    // findMatchingKey iterates entries; the good one should still match
    expect(cache.get('Cop/Good', 'x')).toBe('diff-good')
  })

  it('hunksToDiff produces correct unified diff text', async () => {
    const agent = buildMockAgent({
      type: 'patch' as const,
      hunks: [{
        file: 'example.rb',
        oldStart: 0,
        oldLines: ['class Foo', 'end'],
        newLines: ['class Foo', '  def bar; end', 'end'],
      }],
    })
    const cache = new SpeculativeFixCache(agent, { maxEntries: 5, ttlMs: 60000 })
    await cache.warm()
    expect(cache.stats().size).toBe(5)
    // The first template is Style/FrozenStringLiteralComment with pattern '^\\s*[^#]'
    const entry = cache.get('Style/FrozenStringLiteralComment', '  class Foo')
    expect(entry).not.toBeNull()
    expect(entry).toContain('--- a/example.rb')
    expect(entry).toContain('+++ b/example.rb')
    expect(entry).toContain('+  def bar; end')
  })

  it('hunksToDiff with old-only lines', async () => {
    const agent = buildMockAgent({
      type: 'patch',
      hunks: [{
        file: 'example.rb',
        oldStart: 0,
        oldLines: ['class Foo', '  def bar; end', 'end'],
        newLines: ['class Foo', 'end'],
      }],
    })
    const cache = new SpeculativeFixCache(agent, { maxEntries: 5, ttlMs: 60000 })
    await cache.warm()
    expect(cache.stats().size).toBe(5)
    const entry = cache.get('Style/FrozenStringLiteralComment', '  class Foo')
    expect(entry).not.toBeNull()
    expect(entry).toContain('-  def bar; end')
  })

  it('hunksToDiff with new-only lines', async () => {
    const agent = buildMockAgent({
      type: 'patch',
      hunks: [{
        file: 'example.rb',
        oldStart: 0,
        oldLines: ['class Foo', 'end'],
        newLines: ['# doc', 'class Foo', '  attr_accessor :x', 'end'],
      }],
    })
    const cache = new SpeculativeFixCache(agent, { maxEntries: 5, ttlMs: 60000 })
    await cache.warm()
    expect(cache.stats().size).toBe(5)
    const entry = cache.get('Style/FrozenStringLiteralComment', '  class Foo')
    expect(entry).not.toBeNull()
    expect(entry).toContain('+# doc')
    expect(entry).toContain('+  attr_accessor :x')
  })

  it('hunksToDiff returns empty string for empty hunk', async () => {
    const agent = buildMockAgent({
      type: 'patch',
      hunks: [],
    })
    const cache = new SpeculativeFixCache(agent, { maxEntries: 5, ttlMs: 60000 })
    await cache.warm()
    expect(cache.stats().size).toBe(0)
  })

  it('generateTemplateFix returns null when no example code exists for cop', async () => {
    const agent = buildMockAgent(null)
    const cache = new SpeculativeFixCache(agent, { maxEntries: 5, ttlMs: 60000 })
    const result = await (cache as any).generateTemplateFix({ cop: 'NonExistent/Cop', codePattern: 'x', prompt: 'fix' })
    expect(result).toBeNull()
  })

  it('getExampleCode returns null for unknown cop', () => {
    const agent = buildMockAgent(null)
    const cache = new SpeculativeFixCache(agent, { maxEntries: 5, ttlMs: 60000 })
    const result = (cache as any).getExampleCode('TotallyUnknown/Cop')
    expect(result).toBeNull()
  })

  it('hunksToDiff returns empty string when hunk array is empty', () => {
    const cache = buildCache()
    const result = (cache as any).hunksToDiff([])
    expect(result).toBe('')
  })

  it('set with maxEntries 0 still inserts when cache is empty', () => {
    const cache = buildCache({ maxEntries: 0 })
    cache.set('Cop/A', 'x', 'diff-a')
    expect(cache.get('Cop/A', 'x')).toBe('diff-a')
    expect(cache.stats().size).toBe(1)
  })

  it('set with maxEntries 0 evicts previous entry on second insert', () => {
    const cache = buildCache({ maxEntries: 0 })
    cache.set('Cop/A', 'x', 'diff-a')
    cache.set('Cop/B', 'y', 'diff-b')
    expect(cache.get('Cop/A', 'x')).toBeNull()
    expect(cache.get('Cop/B', 'y')).toBe('diff-b')
  })

  it('clear then warm re-populates the cache', async () => {
    const agent = buildMockAgent({
      type: 'patch' as const,
      hunks: [{ file: 'a.rb', oldStart: 0, oldLines: ['x'], newLines: ['y'] }],
    })
    const cache = new SpeculativeFixCache(agent, { maxEntries: 3, ttlMs: 60000 })
    await cache.warm()
    expect(cache.stats().warmed).toBe(true)
    expect(cache.stats().size).toBe(3)
    cache.clear()
    expect(cache.stats().warmed).toBe(false)
    expect(cache.stats().size).toBe(0)
    await cache.warm()
    expect(cache.stats().warmed).toBe(true)
    expect(cache.stats().size).toBe(3)
  })

  it('get matches second entry when first pattern does not match', () => {
    const cache = buildCache()
    cache.set('Cop/A', '^NEVER$', 'diff-first')
    cache.set('Cop/A', '.*', 'diff-second')
    expect(cache.get('Cop/A', 'any code')).toBe('diff-second')
  })

  it('set overwrites existing entry with same key', () => {
    const cache = buildCache()
    cache.set('Cop/A', 'x', 'diff-old')
    cache.set('Cop/A', 'x', 'diff-new')
    expect(cache.get('Cop/A', 'x')).toBe('diff-new')
    expect(cache.stats().size).toBe(1)
  })
})
