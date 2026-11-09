/**
 * Refactoring advisor - shared types, ports and budgets.
 *
 * The advisor is two halves. The pure half (this folder, no `vscode` import) decides what to look
 * at, builds prompts, validates model output and produces proposed file changes. The VS Code half
 * (RefactorAdvisorCommand.ts) supplies the buffer-aware file reader, shows the suggestions, and
 * applies a confirmed change through RefactoringEditProvider. Everything the pure half needs from
 * the outside world arrives through the narrow ports declared here, so the pipeline is unit-tested
 * with in-memory fakes.
 */

import type { SyntaxCheck } from '../../util/RubySyntax'

/** What the user pointed at: a class or module, a method, or a selected block of code. */
export type RefactorTarget =
  | { kind: 'class'; name: string; startLine: number; endLine: number; text: string }
  | { kind: 'method'; name: string; className?: string; startLine: number; endLine: number; text: string }
  | { kind: 'block'; startLine: number; endLine: number; text: string; enclosingClass?: string; enclosingMethod?: string }

/**
 * Hard limits on what is sent to the model and what is accepted back. They keep prompts inside a
 * local model's default context window (Ollama `num_ctx` 8192 tokens, roughly 24k characters of
 * code once instructions and the answer are reserved) and keep the apply step's full-file
 * reads bounded.
 */
export const ADVISOR_LIMITS = {
  /** Largest target (class, method or selected block) the advisor accepts, in characters. */
  targetMaxChars: 12_000,
  /** The primary file is included whole in the suggestion prompt only up to this size. */
  primaryFileMaxChars: 8_000,
  /** Budget for all context excerpts together (primary file, related files, specs). */
  suggestContextMaxChars: 14_000,
  /** Per excerpt cap for related files and specs. */
  excerptMaxChars: 3_000,
  maxRelatedFiles: 4,
  maxSpecFiles: 2,
  maxCallers: 3,
  maxConventions: 12,
  /** Sum of the current text of every file one suggestion may change. */
  applyMaxChars: 16_000,
  maxSuggestions: 4,
  maxFilesPerSuggestion: 6,
  /** Corrective retries after a rejected model answer (each retry re-sends the full prompt). */
  maxRepairRounds: 1,
} as const

/** Ports the advisor uses. The real adapters satisfy these structurally. */
export interface AdvisorModel {
  run(
    prompt: string,
    context: { isolated: true; isolatedSystemPrompt: string },
  ): Promise<{ success: boolean; response: string }>
}

export interface AdvisorIndex {
  findDefiningFiles(typeName: string): ReadonlyArray<{ relativePath: string }>
  incomingDependencies(toPath: string): ReadonlyArray<{ fromPath: string }>
}

export interface AdvisorCatalog {
  listCatalog(): ReadonlyArray<{ id: string; name: string }>
  listProjectInstances(): ReadonlyArray<{ name: string; filePath: string; publicMethods: readonly string[] }>
}

/**
 * Reads the current text of a workspace file, workspace-relative with forward slashes.
 * Returns undefined when the file does not exist. The VS Code adapter prefers the open editor
 * buffer, so unsaved edits are what the model sees and what the diff is computed against.
 */
export interface SourceReader {
  read(relativePath: string): Promise<string | undefined>
}

export type SyntaxVerdict = SyntaxCheck

export interface RefactorSuggestion {
  /** Stable within one suggest() call: s1, s2, ... */
  id: string
  title: string
  pattern: string
  principle?: string
  impact: 'low' | 'medium' | 'high'
  rationale: string
  /** Workspace-relative paths that passed PathGuard. */
  files: string[]
  steps: string[]
}

export interface ProposedChange {
  path: string
  kind: 'modify' | 'create'
  /** Current text; undefined for a file that does not exist yet. */
  before: string | undefined
  /** Text after the change. Verified as Ruby when a Ruby interpreter is available. */
  after: string
}

export interface ProposedPlan {
  changes: ProposedChange[]
  /** True when no Ruby interpreter was available, so the syntax check could not run. */
  syntaxUnverified: boolean
}

export type AdvisorFailure =
  | 'model-unavailable'
  | 'invalid-response'
  | 'unsafe-path'
  | 'file-not-allowed'
  | 'file-missing'
  | 'file-exists'
  | 'hunk-mismatch'
  | 'syntax-error'
  | 'too-large'
  | 'no-change'

export type AdvisorResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: AdvisorFailure; message: string }
