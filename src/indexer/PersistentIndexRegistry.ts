/**
 * PersistentIndexRegistry - one persistent AST index per workspace root.
 *
 * In a multi-root workspace each project needs its own SQLite file, worker and watchers;
 * a single global index would mix (or miss) projects. Roots are activated lazily (the
 * first time they become the active project) and released when their folder is removed.
 * Generic over the manager type so the lifecycle is unit-testable without vscode/native code.
 */

export interface IndexManagerLike {
  dispose(): void
}

export type IndexOutcome<M> =
  | { status: 'ready'; manager: M }
  | { status: 'unsupported'; reason: string }
  | { status: 'failed'; reason: string }

export type IndexState<M> = { status: 'idle' } | { status: 'starting' } | IndexOutcome<M>

export class PersistentIndexRegistry<M extends IndexManagerLike> {
  private readonly states = new Map<string, IndexState<M>>()
  private readonly inFlight = new Map<string, Promise<IndexState<M>>>()
  private readonly released = new Set<string>()
  /** The runtime can't load the native module at all — true for every root, so don't retry. */
  private unsupported: { status: 'unsupported'; reason: string } | undefined
  private disposed = false

  constructor(
    private readonly activator: (root: string) => Promise<IndexOutcome<M>>,
    private readonly onChange?: (root: string, state: IndexState<M>) => void,
  ) {}

  state(root: string): IndexState<M> {
    return this.states.get(root) ?? { status: 'idle' }
  }

  /** Ready manager for `root`, or null (starting / unsupported / failed / never activated). */
  get(root: string | undefined): M | null {
    if (!root) {return null}
    const s = this.states.get(root)
    return s?.status === 'ready' ? s.manager : null
  }

  /** Starts the index for `root` if needed. Concurrent calls share one activation. */
  ensure(root: string): Promise<IndexState<M>> {
    if (this.disposed || !root) {return Promise.resolve({ status: 'idle' })}

    const existing = this.states.get(root)
    if (existing && existing.status !== 'idle' && existing.status !== 'failed') {
      return Promise.resolve(existing)
    }
    const pending = this.inFlight.get(root)
    if (pending) {return pending}

    if (this.unsupported) {
      this.set(root, this.unsupported)
      return Promise.resolve(this.unsupported)
    }

    this.released.delete(root)
    this.set(root, { status: 'starting' })
    const run = this.activator(root)
      .catch((err: unknown): IndexOutcome<M> => ({ status: 'failed', reason: err instanceof Error ? err.message : String(err) }))
      .then(outcome => {
        this.inFlight.delete(root)
        if (outcome.status === 'unsupported') {this.unsupported = outcome}
        // The folder was removed (or the registry disposed) while the index was starting.
        if (this.disposed || this.released.has(root)) {
          if (outcome.status === 'ready') {outcome.manager.dispose()}
          this.states.delete(root)
          return { status: 'idle' } as IndexState<M>
        }
        this.set(root, outcome)
        return outcome
      })
    this.inFlight.set(root, run)
    return run
  }

  /** Disposes and forgets the index for a removed workspace root. */
  release(root: string): void {
    const s = this.states.get(root)
    if (s?.status === 'ready') {s.manager.dispose()}
    if (this.inFlight.has(root)) {this.released.add(root)}
    this.states.delete(root)
  }

  roots(): string[] {
    return [...this.states.keys()]
  }

  dispose(): void {
    this.disposed = true
    for (const [, s] of this.states) {
      if (s.status === 'ready') {s.manager.dispose()}
    }
    this.states.clear()
  }

  private set(root: string, state: IndexState<M>): void {
    this.states.set(root, state)
    this.onChange?.(root, state)
  }
}
