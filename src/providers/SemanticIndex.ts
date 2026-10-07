/**
 * SemanticIndex - the core-engine facade consumed by every RailsForge provider.
 *
 * The VS Code Extension API surface (vscode.languages / vscode.window / vscode.workspace
 * / vscode.tests / vscode.chat / vscode.lm / vscode.scm / vscode.tasks) is vast, and the
 * temptation in extension development is to scatter raw `vscode.*` calls throughout the
 * business logic. That coupling makes the core engine untestable without booting the
 * entire VS Code runtime.
 *
 * This module is the architectural firewall. Every file under `src/providers/` depends
 * ONLY on the interfaces declared here - never on the concrete indexer, pattern catalog,
 * or principle linter implementations, and never on the `vscode` module for engine
 * queries. The ProviderRegistry is the single place that wires concrete implementations
 * (PersistentIndexManager, ProjectPatternIndexer, DesignPrincipleLinter, PatternCatalog)
 * behind these interfaces.
 *
 * Design rules (enforced by review):
 *   1. No `import * as vscode from 'vscode'` in this file.
 *   2. All shapes are plain TypeScript interfaces / types - no classes that need VS Code.
 *   3. The interface is intentionally minimal: only what providers actually query.
 *   4. Every method is synchronous-read or returns a Promise - never returns VS Code
 *      Disposables. Providers own their own disposables; the engine just answers
 *      questions about the codebase.
 */

/**
 * A single Ruby file the SemanticIndex knows about.
 * `relativePath` is workspace-relative with forward slashes - the canonical form used
 * across the engine, never the OS-specific path.
 */
export interface IndexedRubyFile {
  relativePath: string
  absolutePath: string
  /** Names of all classes/modules defined in this file. */
  definedTypes: readonly string[]
  /** Public method names defined at class/module level (not instance methods on `self`). */
  publicMethods: readonly string[]
  /** Line count of the file - used by SRP / Sandi Metz rules. */
  lineCount: number
}

/**
 * A directed dependency edge: `from` file references a symbol defined in `to` file.
 * The Dependency Graph is built on top of the SQLite index and used by the
 * RelatedCodeLensProvider, DependencyDiagnosticsProvider and RelatedHoverProvider.
 */
export interface DependencyEdge {
  fromPath: string
  toPath: string
  /** The symbol name that produced this edge (class, module, or constant). */
  symbol: string
}

/**
 * A near-duplicate method block detected across the codebase. Surfaced by the
 * `PrincipleCodeActionProvider` as a "Extract shared method" quick fix.
 */
export interface DuplicateMethodGroup {
  fingerprint: string
  /** 1-based line ranges. */
  occurrences: ReadonlyArray<{ relativePath: string; lineStart: number; lineEnd: number; methodName: string }>
}

/**
 * A single design-principle violation detected by the engine. The provider layer
 * converts these into `vscode.Diagnostic` entries and Code Actions.
 */
export interface PrincipleViolation {
  /** Stable identifier (e.g. `srp.class-too-long`, `demeter.chain`, `yagni.dead-method`). */
  id: string
  title: string
  message: string
  /** 1-based line where the violation is reported. */
  line: number
  /** Severity mirrors vscode.DiagnosticSeverity ordering: 0=Error, 1=Warning, 2=Info, 3=Hint. */
  severity: 0 | 1 | 2 | 3
  /** Optional Quick Fix command id (registered in package.json). */
  quickFixCommand?: string
  /** Arguments passed to the Quick Fix command. */
  quickFixArgs?: readonly unknown[]
  /** YAGNI: last line (1-based) of the unused method, so the Quick Fix can delete the block. */
  endLine?: number
  /** Demeter: first receiver and final message in the chain, so the Quick Fix can propose a `delegate`. */
  demeter?: { receiver: string; method: string }
}

/**
 * Read-only access to the SemanticIndex. All providers consume this interface -
 * never the concrete PersistentIndexManager - so they can be unit-tested by passing
 * a hand-rolled in-memory implementation.
 *
 * `undefined` return values mean "engine not ready" or "no answer" - providers must
 * degrade gracefully (skip the CodeLens, skip the hover, etc.) rather than throwing.
 */
export interface SemanticIndex {
  /** True once the background SQLite indexer has finished its initial scan. */
  isReady(): boolean

  /** All Ruby files currently indexed. Empty if not ready. */
  listFiles(): readonly IndexedRubyFile[]

  /** Look up a single file by workspace-relative path. */
  getFile(relativePath: string): IndexedRubyFile | undefined

  /** Find every indexed file that defines the given class or module name. */
  findDefiningFiles(typeName: string): readonly IndexedRubyFile[]

  /** Find every indexed file that references the given class or module name. */
  findReferencingFiles(typeName: string): readonly IndexedRubyFile[]

  /**
   * Outgoing dependency edges from the given file. Used by RelatedCodeLensProvider to
   * render the "linked services / queries" count above a model.
   */
  outgoingDependencies(fromPath: string): readonly DependencyEdge[]

  /** Incoming dependency edges - who depends on this file. */
  incomingDependencies(toPath: string): readonly DependencyEdge[]

  /** True if `fromPath` transitively depends on `toPath` (used for cycle detection). */
  dependsOn(fromPath: string, toPath: string): boolean

  /** All near-duplicate method groups the engine has detected. */
  duplicateMethods(): readonly DuplicateMethodGroup[]

  /**
   * Design-principle violations for a single file. The provider layer calls this on
   * every save (debounced) and converts the result into vscode.Diagnostic entries.
   */
  violationsFor(relativePath: string): readonly PrincipleViolation[]

  /** Re-scan a single file in the background (called by the FileSystemWatcher provider). */
  refreshFile(absolutePath: string): Promise<void>

  /** Drop a file from the index (called when the file is deleted on disk). */
  forgetFile(absolutePath: string): Promise<void>
}

/**
 * Marker type - implementations of `SemanticIndex` should declare `implements SemanticIndex`
 * so the TypeScript compiler enforces the contract.
 */
export const SEMANTIC_INDEX_BRAND = 'RailsForge.SemanticIndex.v1'
