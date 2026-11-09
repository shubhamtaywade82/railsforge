/**
 * RailsForge Refactoring Intelligence - shared contracts.
 *
 * Pipeline (each stage has its own module; nothing skips a stage):
 *
 *   Scope      -> what the developer pointed at (class, method, block)          core/ScopeResolver
 *   Candidates -> deterministic findings, each with measured facts and evidence analyzers/*
 *   Techniques -> design techniques that pass their validators for a candidate  patterns/*
 *   Recommend  -> structured recommendations (deterministic, optionally refined by AI) recommendations/*
 *   Plan       -> an exact multi-file change, validated before it is shown       planning/*
 *
 * The AI never invents a problem: it may only decide on candidates the analyzers produced, and it
 * may only choose a technique that passed that candidate's validators.
 *
 * This module imports nothing from `vscode`, so the whole pipeline is unit-tested with fakes.
 */

import type { SyntaxCheck } from '../../util/RubySyntax'

export type Priority = 'critical' | 'high' | 'medium' | 'low'
export type Confidence = 'high' | 'medium' | 'low'

/** A located fact that supports a candidate or recommendation. `path` is workspace-relative. */
export interface Evidence {
  path: string
  startLine: number
  endLine: number
  note: string
}

/** Every kind of deterministic finding the analyzers can produce. */
export type CandidateKind =
  | 'method.long'
  | 'method.deep-nesting'
  | 'method.many-parameters'
  | 'method.mixed-collaborators'
  | 'method.conditional-chain'
  | 'method.duplicate'
  | 'duplicate.cross-file'
  | 'method.feature-envy'
  | 'method.complex-query'
  | 'class.large'
  | 'class.many-methods'
  | 'class.hard-wired-collaborators'
  | 'class.many-responsibilities'
  | 'class.callback-heavy'
  | 'class.side-effect-callbacks'
  | 'rails.controller-workflow'
  | 'rails.inline-authorization'
  | 'rails.n-plus-one'
  | 'rails.presentation-in-model'
  | 'principle.srp-fat-class'
  | 'principle.demeter'
  | 'principle.yagni-unused-private'

/**
 * How strong the rule behind a candidate is. Confidence is derived from this and from the amount of
 * evidence, never from a model's self-assessment.
 */
export type RuleStrength = 'strong' | 'moderate' | 'weak'

/** The measured values techniques validate against. Each field is set only by the analyzer that measures it. */
export interface CandidateMetrics {
  lines?: number
  depth?: number
  parameters?: number
  methods?: number
  branches?: number
  discriminator?: string
  discriminatorBranches?: number
  nonTrivialBranches?: number
  receivers?: string[]
  receiverCalls?: number
  ownMethodCalls?: number
  persistenceCalls?: number
  externalEffects?: number
  collaborators?: string[]
  instantiated?: string[]
  queryCalls?: number
  authChecks?: number
  presentationCalls?: number
  callbacks?: number
  sideEffectCallbacks?: number
  duplicateOf?: string[]
  /** Workspace-relative files that hold the other copies of a cross-file duplicate. */
  partnerPaths?: string[]
  nPlusOne?: { collection: string; variable: string; association: string; accessLine: number }
  principleId?: string
  demeterReceiver?: string
  unusedMethod?: string
}

/** Where a candidate is anchored for editor UI (CodeLens, lightbulb). */
export type CandidateAnchor = 'class' | 'method' | 'block'

export interface Candidate {
  /** Stable within one analysis run: c1, c2, ... */
  id: string
  kind: CandidateKind
  path: string
  startLine: number
  endLine: number
  anchor: CandidateAnchor
  className?: string
  methodName?: string
  headline: string
  strength: RuleStrength
  /** 1 low, 2 medium, 3 high: how much the problem costs if left alone. */
  severity: 1 | 2 | 3
  metrics: CandidateMetrics
  evidence: Evidence[]
}

/** The scope a developer pointed at, resolved to exact lines. */
export interface ScopeRef {
  kind: CandidateAnchor
  name: string
  className?: string
  startLine: number
  endLine: number
}

export interface RefactorTarget extends ScopeRef {
  text: string
  enclosingClass?: string
  enclosingMethod?: string
}

/** The structured recommendation contract (one per proposed refactoring). */
export interface Recommendation {
  /** Stable within one result set: r1, r2, ... */
  id: string
  source: 'deterministic' | 'ai'
  candidateIds: string[]
  path: string
  scope: ScopeRef
  title: string
  problem: string
  evidence: Evidence[]
  confidence: Confidence
  priority: Priority
  /** The recommended technique, or null when the AI judged the current code appropriate. */
  technique: { id: string; name: string } | null
  design: string
  alternatives: Array<{ name: string; whenBetter: string }>
  benefit: string
  risk: string
  /** Every workspace-relative file the change touches (validated by PathGuard). */
  affectedFiles: string[]
  steps: string[]
  verification: string[]
}

/** Ports the pure pipeline uses. The VS Code and CLI adapters satisfy these structurally. */
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
 * Reads the current text of a workspace file (workspace-relative, forward slashes). Undefined when the
 * file does not exist. The VS Code adapter prefers open editor buffers, so unsaved edits are what the
 * model sees and what a change is computed against.
 */
export interface SourceReader {
  read(relativePath: string): Promise<string | undefined>
}

export type SyntaxVerdict = SyntaxCheck

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

/**
 * Hard limits on what is sent to the model and what is accepted back. They keep prompts inside a
 * local model's default context window (Ollama `num_ctx` 8192 tokens, roughly 24k characters of
 * code once instructions and the answer are reserved).
 */
export const ADVISOR_LIMITS = {
  /** Largest scope (class, method or selected block) analysed in one pass, in characters. */
  targetMaxChars: 12_000,
  primaryFileMaxChars: 8_000,
  suggestContextMaxChars: 14_000,
  excerptMaxChars: 3_000,
  maxRelatedFiles: 4,
  maxSpecFiles: 2,
  maxCallers: 3,
  maxConventions: 12,
  /** Sum of the current text of every file one recommendation may change. */
  applyMaxChars: 16_000,
  /** Recommendations returned from one AI refinement. */
  maxRecommendations: 4,
  /** Deterministic recommendations shown for one scope. */
  maxDeterministic: 8,
  maxFilesPerRecommendation: 6,
  /** Corrective retries after a rejected model answer (each retry re-sends the full prompt). */
  maxRepairRounds: 1,
} as const

export function describeScope(scope: ScopeRef): string {
  if (scope.kind === 'class') {return `class ${scope.name}`}
  if (scope.kind === 'method') {return scope.className ? `method ${scope.className}#${scope.name}` : `method ${scope.name}`}
  return `lines ${scope.startLine}-${scope.endLine}`
}
