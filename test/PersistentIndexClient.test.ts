const mocks = vi.hoisted(() => {
  const mockWorkerOn = vi.fn()
  const mockWorkerOff = vi.fn()
  const mockWorkerPostMessage = vi.fn()
  const mockWorkerTerminate = vi.fn()
  const mockDbClose = vi.fn()
  const mockDbPragma = vi.fn()
  let forceDbError = false
  return {
    mockWorkerOn,
    mockWorkerOff,
    mockWorkerPostMessage,
    mockWorkerTerminate,
    mockDbClose,
    mockDbPragma,
    get forceDbError() { return forceDbError },
    set forceDbError(v: boolean) { forceDbError = v },
  }
})

vi.mock('worker_threads', () => {
  function MockWorker(_script: string, _opts?: unknown) {
    return {
      on: mocks.mockWorkerOn,
      off: mocks.mockWorkerOff,
      postMessage: mocks.mockWorkerPostMessage,
      terminate: mocks.mockWorkerTerminate,
    }
  }
  return { Worker: MockWorker }
})

vi.mock('../src/indexer/database', () => ({
  openIndexDatabase: (...args: unknown[]) => {
    if (mocks.forceDbError) {
      throw new Error('db open failed')
    }
    return {
      close: mocks.mockDbClose,
      pragma: mocks.mockDbPragma,
    }
  },
}))

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PersistentIndexClient } from '../src/indexer/PersistentIndexClient'

describe('PersistentIndexClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setupMessageHandler(): (msg: unknown) => void {
    let handler: ((msg: unknown) => void) | null = null
    mocks.mockWorkerOn.mockImplementation((event: string, cb: (msg: unknown) => void) => {
      if (event === 'message') handler = cb
    })
    return (msg: unknown) => {
      if (handler) handler(msg)
    }
  }

  async function createClient(sendMsg?: (msg: unknown) => void): Promise<PersistentIndexClient> {
    const send = sendMsg ?? setupMessageHandler()
    const promise = PersistentIndexClient.create('/worker.js', '/db.sqlite3')
    send({ type: 'ready' })
    return promise
  }

  it('resolves with a client when worker sends ready signal and db opens', async () => {
    const send = setupMessageHandler()
    const promise = PersistentIndexClient.create('/worker.js', '/db.sqlite3')
    send({ type: 'ready' })
    const client = await promise
    expect(client).toBeInstanceOf(PersistentIndexClient)
    expect(mocks.mockWorkerOff).toHaveBeenCalledWith('message', expect.any(Function))
  })

  it('rejects when worker emits error event', async () => {
    let errorHandler: ((err: Error) => void) | null = null
    mocks.mockWorkerOn.mockImplementation((event: string, handler: (err: Error) => void) => {
      if (event === 'error') errorHandler = handler
    })

    const promise = PersistentIndexClient.create('/worker.js', '/db.sqlite3') as Promise<never>
    expect(errorHandler).not.toBeNull()
    errorHandler!(new Error('worker crashed'))

    await expect(promise).rejects.toThrow('worker crashed')
  })

  it('indexFile sends message with requestId and waits for ack', async () => {
    const send = setupMessageHandler()
    const client = await createClient(send)

    const indexPromise = client.indexFile('/path/to/file.rb', 'class Foo; end')

    expect(mocks.mockWorkerPostMessage).toHaveBeenCalledWith({
      type: 'index_file',
      filePath: '/path/to/file.rb',
      content: 'class Foo; end',
      requestId: 1,
    })

    send({ type: 'done', requestId: 1 })
    await indexPromise
  })

  it('removeFile sends message and waits for ack', async () => {
    const send = setupMessageHandler()
    const client = await createClient(send)

    const removePromise = client.removeFile('/path/to/file.rb')
    expect(mocks.mockWorkerPostMessage).toHaveBeenCalledWith({
      type: 'remove_file',
      filePath: '/path/to/file.rb',
      requestId: 1,
    })

    send({ type: 'done', requestId: 1 })
    await removePromise
  })

  it('rejects pending request when worker sends error with requestId', async () => {
    const send = setupMessageHandler()
    const client = await createClient(send)

    const indexPromise = client.indexFile('/f.rb', 'content')
    send({ type: 'error', requestId: 1, message: 'parse failed' })

    await expect(indexPromise).rejects.toThrow('parse failed')
  })

  it('rejects pending request with default message when worker error has no message', async () => {
    const send = setupMessageHandler()
    const client = await createClient(send)

    const indexPromise = client.indexFile('/f.rb', 'content')
    send({ type: 'error', requestId: 1 })

    await expect(indexPromise).rejects.toThrow('Unknown indexer worker error')
  })

  it('ignores messages without requestId', () => {
    const send = setupMessageHandler()
    PersistentIndexClient.create('/worker.js', '/db.sqlite3')
    expect(() => send({ type: 'ready' })).not.toThrow()
    expect(() => send({ type: 'unknown' })).not.toThrow()
  })

  it('dispose terminates worker and closes db', async () => {
    const client = await createClient()
    client.dispose()
    expect(mocks.mockWorkerTerminate).toHaveBeenCalled()
    expect(mocks.mockDbClose).toHaveBeenCalled()
  })

  it('getDb returns the database handle', async () => {
    const client = await createClient()
    const db = client.getDb()
    expect(db).toBeDefined()
    expect(db.close).toBe(mocks.mockDbClose)
  })

  it('ignores messages with unknown requestId', async () => {
    const send = setupMessageHandler()
    const client = await createClient(send)

    const indexPromise = client.indexFile('/f.rb', 'c')
    send({ type: 'done', requestId: 999 })
    send({ type: 'done', requestId: 1 })
    await indexPromise
  })

  it('increments requestId for each request', async () => {
    const send = setupMessageHandler()
    const client = await createClient(send)

    const p1 = client.indexFile('/a.rb', 'a')
    const p2 = client.removeFile('/b.rb')
    const p3 = client.indexFile('/c.rb', 'c')

    expect(mocks.mockWorkerPostMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ requestId: 1 }))
    expect(mocks.mockWorkerPostMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ requestId: 2 }))
    expect(mocks.mockWorkerPostMessage).toHaveBeenNthCalledWith(3, expect.objectContaining({ requestId: 3 }))

    send({ type: 'done', requestId: 1 })
    send({ type: 'done', requestId: 2 })
    send({ type: 'done', requestId: 3 })
    await Promise.all([p1, p2, p3])
  })

  it('rejects when openIndexDatabase throws after worker ready', async () => {
    mocks.forceDbError = true
    const send = setupMessageHandler()
    const promise = PersistentIndexClient.create('/worker.js', '/db.sqlite3') as Promise<never>
    send({ type: 'ready' })
    await expect(promise).rejects.toThrow('db open failed')
    mocks.forceDbError = false
  })

  it('ignores non-ready messages while waiting for ready signal', async () => {
    const send = setupMessageHandler()
    const promise = PersistentIndexClient.create('/worker.js', '/db.sqlite3')
    // Send non-ready messages before ready — should be ignored
    send({ type: 'indexing' })
    send({ type: 'error' })
    send({ type: 'ready' })
    const client = await promise
    expect(client).toBeInstanceOf(PersistentIndexClient)
    expect(mocks.mockWorkerOff).toHaveBeenCalledWith('message', expect.any(Function))
  })
})
