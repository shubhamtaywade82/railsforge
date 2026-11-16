/**
 * OnceByKey - runs a task at most once per key and hands the same promise to every caller.
 *
 * Used for work that a hot path may request repeatedly (a hover asks for the offline DevDocs index on every
 * keystroke-driven lookup). The first call starts the task; later calls get the same promise, settled or not.
 * A failed task is not retried automatically: retrying from a hover would turn one offline failure into a
 * request per hover. Callers that want a retry clear the key explicitly.
 *
 * vscode-free.
 */
export class OnceByKey<K, V> {
  private readonly tasks = new Map<K, Promise<V>>()

  /** Starts `task` for `key` unless it already started; always returns the key's single promise. */
  run(key: K, task: () => Promise<V>): Promise<V> {
    const existing = this.tasks.get(key)
    if (existing) {return existing}
    // new Promise() turns a synchronous throw from `task` into a rejection, so the key is always memoized.
    const started = new Promise<V>(resolve => resolve(task()))
    this.tasks.set(key, started)
    return started
  }

  has(key: K): boolean {
    return this.tasks.has(key)
  }

  /** Forgets `key` so the next `run` starts the task again (an explicit retry). */
  clear(key: K): void {
    this.tasks.delete(key)
  }
}
