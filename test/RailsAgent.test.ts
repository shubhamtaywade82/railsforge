import { existsSync } from 'fs'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { RailsAgent } from '../src/agent/RailsAgent'
import { SchemaIndexer } from '../src/rails/SchemaIndexer'
import { RoutesIndexer } from '../src/rails/RoutesIndexer'
import { cassetteFetch, cassettePath } from './support/cassette'

function buildAgent(overrides: Partial<ConstructorParameters<typeof RailsAgent>[2]>): RailsAgent {
  return new RailsAgent(new SchemaIndexer(), new RoutesIndexer(), {
    ollamaHost: 'http://localhost:11434',
    model: 'qwen2.5-coder:14b',
    ...overrides,
  })
}

const OLLAMA_CASSETTE = 'rails-agent-ollama-chat'
const ANTHROPIC_CASSETTE = 'rails-agent-anthropic-message'
const hasAnthropicCassette = existsSync(cassettePath(ANTHROPIC_CASSETTE))

describe('RailsAgent provider dispatch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls Ollama via @nemesis-oss/ollama-sdk by default, with no Authorization header, and parses a real recorded response', async () => {
    // rails-agent-ollama-chat.json was recorded from a genuine LLM call (see
    // test/cassettes/record.mjs) — this validates RailsAgent's response parsing
    // against an actual Ollama-compatible chat-completion payload, not a hand-typed guess.
    const fetchMock = vi.fn(cassetteFetch(OLLAMA_CASSETTE))
    vi.stubGlobal('fetch', fetchMock)

    const agent = buildAgent({})
    const result = await agent.run('In one sentence, what does ActiveRecord::Base#save do?', {})

    expect(result.success).toBe(true)
    expect(result.iterations).toBe(1)
    expect(result.response).toContain('inserts')
    expect(result.response.toLowerCase()).toContain('database')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:11434/api/chat')
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('calls OpenAI with a Bearer token when provider is openai, parsing the same OpenAI-compatible response shape', async () => {
    // RailsAgent's openai and ollama branches both go through the same
    // callOpenAiCompatible parser (see src/agent/RailsAgent.ts) — the recorded
    // Ollama cassette is a genuine example of that exact response shape, so it
    // validates the openai branch's parsing too, without needing a second
    // near-identical recording. Request construction (URL, auth header, model)
    // is asserted independently below, since that part isn't provider-shape-dependent.
    const fetchMock = vi.fn(cassetteFetch(OLLAMA_CASSETTE))
    vi.stubGlobal('fetch', fetchMock)

    const agent = buildAgent({ provider: 'openai', openaiModel: 'gpt-4o-mini', getApiKey: async () => 'sk-test' })
    const result = await agent.run('In one sentence, what does ActiveRecord::Base#save do?', {})

    expect(result.success).toBe(true)
    expect(result.response).toContain('database')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(init.body as string).model).toBe('gpt-4o-mini')
  })

  it('sends the shared AI knobs (temperature, max_tokens) to cloud providers and never the Ollama-only ones', async () => {
    const fetchMock = vi.fn(cassetteFetch(OLLAMA_CASSETTE))
    vi.stubGlobal('fetch', fetchMock)

    const agent = buildAgent({
      provider: 'openai',
      openaiModel: 'gpt-oss:120b',
      openaiBaseUrl: 'https://openrouter.ai/api',
      temperature: 0.5,
      maxTokens: 4096,
      ollamaNumCtx: 16384,
      ollamaKeepAlive: '5m',
      getApiKey: async () => 'sk-test',
    })
    await agent.run('hello', {})

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gpt-oss:120b')
    expect(body.temperature).toBe(0.5)
    expect(body.max_tokens).toBe(4096)
    // Ollama-only knobs must never leak into a cloud request.
    expect(body.num_ctx).toBeUndefined()
    expect(body.num_predict).toBeUndefined()
    expect(body.repeat_penalty).toBeUndefined()
    expect(body.min_p).toBeUndefined()
    expect(body.keep_alive).toBeUndefined()
  })

  it('sends num_ctx, num_predict, repeat_penalty, min_p and keep_alive to Ollama with configured values', async () => {
    const fetchMock = vi.fn(cassetteFetch(OLLAMA_CASSETTE))
    vi.stubGlobal('fetch', fetchMock)

    const agent = buildAgent({
      temperature: 0.1,
      maxTokens: 512,
      ollamaNumCtx: 16384,
      ollamaKeepAlive: '5m',
      ollamaRepeatPenalty: 1.2,
      ollamaMinP: 0.1,
    })
    await agent.run('hello', {})

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.options.temperature).toBe(0.1)
    expect(body.options.num_predict).toBe(512)
    expect(body.options.num_ctx).toBe(16384)
    expect(body.options.repeat_penalty).toBe(1.2)
    expect(body.options.min_p).toBe(0.1)
    expect(body.keep_alive).toBe('5m')
  })

  it('fails clearly when provider is openai and no key is configured, without calling fetch', async () => {
    // No cassette needed: this path returns before making any request.
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const agent = buildAgent({ provider: 'openai', getApiKey: async () => undefined })
    const result = await agent.run('hello', {})

    expect(result.success).toBe(false)
    expect(result.response).toContain('No OpenAI API key configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.skipIf(!hasAnthropicCassette)(
    'calls Anthropic Messages API with x-api-key and extracts the text content block, parsing a real recorded response',
    async () => {
      const fetchMock = vi.fn(cassetteFetch(ANTHROPIC_CASSETTE))
      vi.stubGlobal('fetch', fetchMock)

      const agent = buildAgent({ provider: 'anthropic', anthropicModel: 'claude-sonnet-4-5', getApiKey: async () => 'anthropic-key' })
      const result = await agent.run('In one sentence, what does ActiveRecord::Base#save do?', {})

      expect(result.success).toBe(true)
      expect(result.response.length).toBeGreaterThan(0)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.anthropic.com/v1/messages')
      const headers = init.headers as Record<string, string>
      expect(headers['x-api-key']).toBe('anthropic-key')
      expect(headers['anthropic-version']).toBeTruthy()
      expect(JSON.parse(init.body as string).model).toBe('claude-sonnet-4-5')
    },
  )

  if (!hasAnthropicCassette) {
    it.todo(
      `anthropic cassette not recorded in this environment (no ANTHROPIC_API_KEY was available) — ` +
      `run 'ANTHROPIC_API_KEY=... node test/cassettes/record.mjs' to record ${ANTHROPIC_CASSETTE}.json and un-skip the test above`,
    )
  }

  it('adds legal-domain guardrails to the system prompt when legal mode is enabled', async () => {
    const fetchMock = vi.fn(cassetteFetch(OLLAMA_CASSETTE))
    vi.stubGlobal('fetch', fetchMock)

    const agent = buildAgent({ legalMode: true })
    await agent.run('Draft a mutual NDA clause for an India-focused SaaS customer.', {})

    const [, init] = fetchMock.mock.calls[0]
    const systemPrompt = (JSON.parse(init.body as string).messages as Array<{ role: string; content: string }>)
      .find(m => m.role === 'system')?.content
    expect(systemPrompt).toContain('Legal-domain skills enabled (lawvable)')
    expect(systemPrompt).toContain('Ask for jurisdiction and governing law')
    expect(systemPrompt).toContain('do not present them as legal advice')
  })

  describe('getProviderStatus (cloud)', () => {
    const jsonRes = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'ERR' })

    it('is unconfigured without a key and never calls fetch', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const status = await buildAgent({ provider: 'anthropic', getApiKey: async () => undefined }).getProviderStatus()
      expect(status.state).toBe('unconfigured')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('is authenticated only when the endpoint accepts the key and lists the model', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonRes(200, { data: [{ id: 'claude-sonnet-4-5' }] })))
      const agent = buildAgent({ provider: 'anthropic', getApiKey: async () => 'k' })
      expect((await agent.getProviderStatus()).state).toBe('authenticated')
      expect(await agent.healthCheck()).toBe(true)
    })

    it('reports a rejected key, a missing model, and an unreachable endpoint distinctly', async () => {
      const agent = buildAgent({ provider: 'openai', openaiModel: 'gpt-x', getApiKey: async () => 'k' })

      vi.stubGlobal('fetch', vi.fn(async () => jsonRes(401, {})))
      expect(await agent.getProviderStatus()).toMatchObject({ state: 'error', detail: expect.stringContaining('rejected') })

      vi.stubGlobal('fetch', vi.fn(async () => jsonRes(200, { data: [{ id: 'gpt-4o' }] })))
      expect(await agent.getProviderStatus()).toMatchObject({ state: 'error', detail: expect.stringContaining('gpt-x') })

      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ENOTFOUND') }))
      expect((await agent.getProviderStatus()).state).toBe('offline')
      expect(await agent.healthCheck()).toBe(false)
    })
  })

  it(
    'suggestFix tells the model to stay consistent with sibling methods and never close a caller-owned resource',
    async () => {
      // Regression test: applying the AI fix to two methods that share a resource (e.g. two
      // methods each opening a Redis connection) independently, one at a time, previously
      // produced inconsistent fixes — one method gained an injectable `@redis` seam, the
      // other didn't, and the seam's own fix closed `@redis` even when it might be
      // caller-supplied. Both failure modes trace back to instructions missing from the
      // prompt below, not model flakiness — this locks the instructions in place.
      const fetchMock = vi.fn(cassetteFetch(OLLAMA_CASSETTE))
      vi.stubGlobal('fetch', fetchMock)

      const agent = buildAgent({})
      await agent.suggestFix('def foo\n  1\nend', 'Method too short', {
        fileContent: 'class Foo\n  def foo\n    1\n  end\nend',
      })

      const [, init] = fetchMock.mock.calls[0]
      const prompt = (JSON.parse(init.body as string).messages as Array<{ role: string; content: string }>)
        .find(m => m.role === 'user')?.content

      expect(prompt).toContain('sibling method')
      expect(prompt).toContain('Never close, disconnect, or otherwise release an object this snippet did not itself create')
    },
  )

  it('suggestFix accepts module header documentation fixes without triggering the safety guard', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        message: {
          content: '# Top-level documentation for StringUtils\nmodule MyToolbox::StringUtils',
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const agent = buildAgent({})
    const fix = await agent.suggestFix(
      'module MyToolbox::StringUtils',
      'Style/Documentation: Missing top-level documentation comment for `module MyToolbox::StringUtils`.',
      { fileContent: 'module MyToolbox::StringUtils\n  def self.slug(s)\n    s.downcase\n  end\nend' },
    )

    expect(fix).toEqual({ type: 'snippet', code: '# Top-level documentation for StringUtils\nmodule MyToolbox::StringUtils' })
  })

  it('suggestFix truncates a whole-class response down to the header for documentation fixes', async () => {
    // Regression test: models frequently answer a Style/Documentation fix on a
    // single-line class header by returning the ENTIRE class (or file). The
    // replacement range only covers the header line, so the body would duplicate
    // the file — the agent must keep only the comment/header portion instead of
    // rejecting the fix outright (which previously made Style/Documentation
    // fixes always report "Fix unavailable").
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        message: {
          content: [
            '# Represents an order placed by a customer.',
            'class Order < ApplicationRecord',
            '  belongs_to :customer',
            '  has_many :line_items',
            'end',
          ].join('\n'),
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const agent = buildAgent({})
    const fix = await agent.suggestFix(
      'class Order < ApplicationRecord',
      'Style/Documentation: Missing top-level documentation comment for `class Order`.',
      { fileContent: 'class Order < ApplicationRecord\n  belongs_to :customer\n  has_many :line_items\nend' },
    )

    expect(fix).toEqual({ type: 'snippet', code: '# Represents an order placed by a customer.\nclass Order < ApplicationRecord' })
  })

  it('suggestFix keeps the original header when a comment-only response would delete the class declaration', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        message: {
          content: '# Comment only, no class declaration returned',
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const agent = buildAgent({})
    const fix = await agent.suggestFix(
      'class Order < ApplicationRecord',
      'Style/Documentation: Missing top-level documentation comment for `class Order`.',
      { fileContent: 'class Order < ApplicationRecord\nend' },
    )

    expect(fix).toEqual({ type: 'snippet', code: '# Comment only, no class declaration returned\nclass Order < ApplicationRecord' })
  })

  it('suggestFix parses a unified diff response into a patch proposal', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        message: {
          content: [
            '--- a/app/models/order.rb',
            '+++ b/app/models/order.rb',
            '@@ -1,3 +1,4 @@',
            ' class Order < ApplicationRecord',
            '+  scope :recent, -> { where(created_at: 1.day.ago..) }',
            ' end',
          ].join('\n'),
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const agent = buildAgent({})
    const fix = await agent.suggestFix(
      'class Order < ApplicationRecord\nend',
      'Lint/MissingScope',
      { fileContent: 'class Order < ApplicationRecord\nend' },
    )

    expect(fix).toEqual({
      type: 'patch',
      hunks: [
        {
          file: 'app/models/order.rb',
          oldStart: 0,
          oldLines: ['class Order < ApplicationRecord', 'end'],
          newLines: ['class Order < ApplicationRecord', '  scope :recent, -> { where(created_at: 1.day.ago..) }', 'end'],
        },
      ],
    })
  })

  it('suggestFix retries with a strict format demand when the first response looks like a diff but fails to parse', async () => {
    // Regression test: local models sometimes respond with prose + diff-like
    // fragments that fail parsing. Previously this fell through to the snippet
    // path, splicing diff text into the file and producing invalid Ruby — the
    // exact "response would produce invalid Ruby syntax" rejection in the logs.
    // The first malformed response must trigger a corrective retry, not a snippet.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: 'Here is the fix:\n@@ -1,1 +1,1 @@\n-[:create, :update]\n+%i[create update]\n`' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: ['@@ -1,1 +1,1 @@', '-[:create, :update]', '+%i[create update]'].join('\n') } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const agent = buildAgent({})
    const fix = await agent.suggestFix('[:create, :update]', 'Style/SymbolArray', { fileContent: '[:create, :update]' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, init] = fetchMock.mock.calls[1]
    const prompt = (JSON.parse(init.body as string).messages as Array<{ role: string; content: string }>)
      .find(m => m.role === 'user')?.content
    expect(prompt).toContain('was not a valid unified diff')
    expect(fix).toEqual({
      type: 'patch',
      hunks: [
        {
          file: null,
          oldStart: 0,
          oldLines: ['[:create, :update]'],
          newLines: ['%i[create update]'],
        },
      ],
    })
  })

  it('suggestFix carries Ruby syntax feedback into the corrected request', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        message: { content: ['@@ -1,1 +1,1 @@', '-foo', '+bar'].join('\n') },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const agent = buildAgent({})
    await agent.suggestFix('foo', 'Lint/X', { fileContent: 'foo' }, 'syntax error: unexpected end-of-input')

    const [, init] = fetchMock.mock.calls[0]
    const prompt = (JSON.parse(init.body as string).messages as Array<{ role: string; content: string }>)
      .find(m => m.role === 'user')?.content
    expect(prompt).toContain('unexpected end-of-input')
    expect(prompt).toContain('Return a corrected minimal unified diff')
  })
})
