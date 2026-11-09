/**
 * PersistentIndexClient - extension-host-side handle to the indexer worker thread.
 * Owns posting index/remove requests to the worker and holds the main thread's own
 * read-only SQLite connection (safe to read concurrently with the worker's writes
 * under WAL mode) for PersistentDependencyGraph/DuplicateMethodDetector to query.
 *
 * Thin glue, deliberately not unit tested here (same as the rest of this codebase's
 * vscode/worker_threads integration code) — PersistentIndexer.ts and database.ts,
 * which contain the actual logic, are tested directly against an in-memory database.
 */

import { Worker } from 'worker_threads'
import { openIndexDatabase, SqliteDatabase } from './database'

export class PersistentIndexClient {
  private worker: Worker
  private readonly db: SqliteDatabase
  private pending: Map<number, { resolve: () => void; reject: (err: Error) => void }> = new Map()
  private nextRequestId = 1
  private completedWrites = 0

  private constructor(worker: Worker, db: SqliteDatabase) {
    this.worker = worker
    this.db = db
    this.worker.on('message', (msg: { type: string; requestId?: number; message?: string }) => {
      if (msg.requestId === undefined) {return}
      const entry = this.pending.get(msg.requestId)
      if (!entry) {return}
      this.pending.delete(msg.requestId)
      if (msg.type === 'error') {
        entry.reject(new Error(msg.message ?? 'Unknown indexer worker error'))
      } else {
        entry.resolve()
      }
    })
  }

  /**
   * Waits for the worker's `ready` signal (its DB file + WAL mode exist) before opening
   * the main thread's own read-only connection to the same path — opening it too early
   * (fileMustExist: true) would throw if the worker hasn't created the file yet.
   */
  static create(workerScriptPath: string, dbPath: string): Promise<PersistentIndexClient> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerScriptPath, { workerData: { dbPath } })
      const onReady = (msg: { type: string }): void => {
        if (msg.type !== 'ready') {return}
        worker.off('message', onReady)
        try {
          const db = openIndexDatabase(dbPath, true)
          resolve(new PersistentIndexClient(worker, db))
        } catch (err) {
          reject(err as Error)
        }
      }
      worker.on('message', onReady)
      worker.on('error', reject)
    })
  }

  getDb(): SqliteDatabase {
    return this.db
  }

  /**
   * Counts writes the worker has completed. The worker posts `done` only after its database write,
   * so a value read after a write resolves always covers that write. Anything derived from the index
   * (for example the duplicate groups) is valid for exactly one value of this counter.
   */
  get indexGeneration(): number {
    return this.completedWrites
  }

  indexFile(filePath: string, content: string): Promise<void> {
    return this.send({ type: 'index_file', filePath, content }).then(() => {
      this.completedWrites++
    })
  }

  removeFile(filePath: string): Promise<void> {
    return this.send({ type: 'remove_file', filePath }).then(() => {
      this.completedWrites++
    })
  }

  private send(message: { type: string; filePath: string; content?: string }): Promise<void> {
    const requestId = this.nextRequestId++
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      this.worker.postMessage({ ...message, requestId })
    })
  }

  dispose(): void {
    void this.worker.terminate()
    this.db.close()
  }
}
