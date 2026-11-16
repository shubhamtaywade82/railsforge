// Stopping a request ends the HTTP request itself, not only the wait for it. A local server accepts each request and never
// answers, so the only way the agent can return is by cancelling. The server records whether the connection was closed.
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as http from 'http'
import type { AddressInfo } from 'net'
import { RailsAgent } from '../src/agent/RailsAgent'
import { SchemaIndexer } from '../src/rails/SchemaIndexer'
import { RoutesIndexer } from '../src/rails/RoutesIndexer'

interface SilentServer {
  url: string
  requests: number
  closed: () => number
  close(): Promise<void>
}

/** Accepts every request and never answers. `closed()` counts the requests whose connection the client has dropped. */
async function silentServer(): Promise<SilentServer> {
  let requests = 0
  let closed = 0
  const server = http.createServer((req) => {
    requests++
    req.on('close', () => { closed++ })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    get requests() { return requests },
    closed: () => closed,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }),
  }
}

describe('stopping a request ends the HTTP request', () => {
  let server: SilentServer | undefined

  afterEach(async () => {
    await server?.close()
    server = undefined
  })

  it('Ollama: the request is aborted, the agent reports it cancelled, and the connection is dropped', async () => {
    server = await silentServer()
    const agent = new RailsAgent(new SchemaIndexer(), new RoutesIndexer(), {
      ollamaHost: server.url,
      model: 'qwen2.5-coder:14b',
      provider: 'ollama',
    })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)

    const started = Date.now()
    const result = await agent.run('Explain the order model.', { fileContent: '', fileName: '', selection: '', signal: controller.signal } as never)

    expect(result).toMatchObject({ success: false, response: 'Cancelled.' })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(server.requests).toBeGreaterThanOrEqual(1)
    await vi.waitFor(() => expect(server?.closed()).toBeGreaterThanOrEqual(1))
  }, 20_000)

  it('OpenAI-compatible: the request is aborted, the agent reports it cancelled, and the connection is dropped', async () => {
    server = await silentServer()
    const agent = new RailsAgent(new SchemaIndexer(), new RoutesIndexer(), {
      provider: 'openai',
      openaiBaseUrl: server.url,
      openaiModel: 'gpt-test',
      model: 'unused',
      ollamaHost: 'http://127.0.0.1:1',
      getApiKey: async () => 'test-key',
    })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)

    const started = Date.now()
    const result = await agent.run('Explain the order model.', { fileContent: '', fileName: '', selection: '', signal: controller.signal } as never)

    expect(result).toMatchObject({ success: false, response: 'Cancelled.' })
    expect(Date.now() - started).toBeLessThan(5_000)
    await vi.waitFor(() => expect(server?.closed()).toBeGreaterThanOrEqual(1))
  }, 20_000)
})
