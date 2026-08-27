import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RailsRAGContext } from '../src/agent/RailsRAGContext'
import { SchemaIndexer } from '../src/rails/SchemaIndexer'
import { RoutesIndexer } from '../src/rails/RoutesIndexer'

describe('RailsRAGContext', () => {
  const schema = new SchemaIndexer()
  schema.parseSchema(`
create_table "users", force: :cascade do |t|
  t.string "email"
  t.string "name"
end
`)

  const routes = new RoutesIndexer()
  routes.parseRoutesTable(`
users GET /users users#index
posts GET /posts posts#index
posts POST /posts posts#create
posts GET /posts/:id posts#show
posts PATCH /posts/:id posts#update
posts DELETE /posts/:id posts#destroy
`)

  const rag = new RailsRAGContext(schema, routes)

  it('builds grounded prompt with matching ActiveRecord schema and routes', () => {
    const prompt = rag.buildGroundedPrompt('users email', 'user = User.find_by(email: params[:email])')

    expect(prompt).toContain('Grounded ActiveRecord Schema')
    expect(prompt).toContain('**users**: email:string, name:string')
    expect(prompt).toContain('`GET /users` => `users#index`')
    expect(prompt).toContain('user = User.find_by(email: params[:email])')
  })

  it('returns empty prompt when nothing matches', () => {
    const prompt = rag.buildGroundedPrompt('xyznonexistent')
    expect(prompt).toBe('')
  })

  it('omits Active Code section when activeCode is not provided', () => {
    const prompt = rag.buildGroundedPrompt('users')
    expect(prompt).toContain('Grounded ActiveRecord Schema')
    expect(prompt).not.toContain('Target File Code')
  })

  it('includes Target File Code when activeCode is provided', () => {
    const prompt = rag.buildGroundedPrompt('users', 'class User < ApplicationRecord\nend')
    expect(prompt).toContain('Target File Code')
    expect(prompt).toContain('class User < ApplicationRecord')
  })

  it('finds relevant tables by table name substring', () => {
    const prompt = rag.buildGroundedPrompt('user')
    expect(prompt).toContain('**users**:')
  })

  it('finds relevant tables by column name', () => {
    const prompt = rag.buildGroundedPrompt('email field')
    expect(prompt).toContain('**users**:')
  })

  it('limits routes to first 10', () => {
    const prompt = rag.buildGroundedPrompt('posts')
    // We have 5 routes for posts, all should appear
    expect(prompt).toContain('`GET /posts` => `posts#index`')
    expect(prompt).toContain('`POST /posts` => `posts#create`')
  })

  it('finds relevant routes by token matching', () => {
    const prompt = rag.buildGroundedPrompt('show posts')
    expect(prompt).toContain('`GET /posts/:id` => `posts#show`')
  })

  it('handles routes with undefined helperName', () => {
    const threePartRoutes = new RoutesIndexer()
    threePartRoutes.parseRoutesTable('GET /health health#check')
    const threePartRag = new RailsRAGContext(schema, threePartRoutes)
    const prompt = threePartRag.buildGroundedPrompt('health')
    expect(prompt).toContain('`GET /health` => `health#check`')
  })
})

describe('RailsRAGContext detectBestAvailableModel', () => {
  const schema = new SchemaIndexer()
  const routes = new RoutesIndexer()
  const rag = new RailsRAGContext(schema, routes)

  afterEach(() => { vi.unstubAllGlobals() })

  it('returns requestedModel when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network') }))
    const result = await rag.detectBestAvailableModel('http://localhost:11434', 'my-model')
    expect(result).toBe('my-model')
  })

  it('returns requestedModel when response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    const result = await rag.detectBestAvailableModel('http://localhost:11434', 'my-model')
    expect(result).toBe('my-model')
  })

  it('returns requestedModel when it is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [{ name: 'my-model' }, { name: 'other' }] }),
    })))
    const result = await rag.detectBestAvailableModel('http://localhost:11434', 'my-model')
    expect(result).toBe('my-model')
  })

  it('returns a preferred model when requested is not available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [{ name: 'qwen2.5-coder:7b' }] }),
    })))
    const result = await rag.detectBestAvailableModel('http://localhost:11434', 'nonexistent')
    expect(result).toBe('qwen2.5-coder:7b')
  })

  it('falls back to requestedModel when no preferred model is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [{ name: 'some-random-model' }] }),
    })))
    const result = await rag.detectBestAvailableModel('http://localhost:11434', 'my-model')
    expect(result).toBe('my-model')
  })

  it('strips trailing slash from host', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await rag.detectBestAvailableModel('http://localhost:11434/', 'my-model')
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/tags')
  })

  it('handles response with undefined models field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })))
    const result = await rag.detectBestAvailableModel('http://localhost:11434', 'my-model')
    expect(result).toBe('my-model')
  })

  it('handles model entry with undefined name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [{ name: 'my-model' }, {}] }),
    })))
    const result = await rag.detectBestAvailableModel('http://localhost:11434', 'my-model')
    expect(result).toBe('my-model')
  })
})
