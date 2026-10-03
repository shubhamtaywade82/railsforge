/**
 * PerRootRegistry - lazily creates and caches one `T` per workspace root.
 * Used for state that must never be shared between projects in a multi-root workspace
 * (offline docs caches, RBS signatures, ...).
 */
export class PerRootRegistry<T> {
  private readonly items = new Map<string, T>()

  constructor(
    private readonly factory: (root: string) => T,
    private readonly onDrop?: (value: T) => void,
  ) {}

  /** The value for `root`, created on first use. */
  get(root: string): T {
    let value = this.items.get(root)
    if (value === undefined) {
      value = this.factory(root)
      this.items.set(root, value)
    }
    return value
  }

  has(root: string): boolean {
    return this.items.has(root)
  }

  roots(): string[] {
    return [...this.items.keys()]
  }

  drop(root: string): void {
    const value = this.items.get(root)
    if (value === undefined) {return}
    this.items.delete(root)
    this.onDrop?.(value)
  }

  /** Drops every root not in `keep` (e.g. after workspace folders were removed). */
  retainOnly(keep: Iterable<string>): void {
    const set = new Set(keep)
    for (const root of this.roots()) {
      if (!set.has(root)) {this.drop(root)}
    }
  }
}
