/**
 * AnalysisContext - the input every analyzer receives, and the helpers they share.
 *
 * Analyzers are pure: they receive parsed types, the file text and optional engine facts (schema
 * tables, linter findings, a project-type predicate). They never touch the filesystem or `vscode`.
 */

import type { ParsedMethod, ParsedTypeDefinition } from '../../indexer/RubyAstParser'
import type { SchemaLike } from '../../rails/NPlusOneAnalyzer'
import type { Candidate, CandidateKind, Evidence, RuleStrength } from '../core/types'

/** A finding from the existing design-principle linter, already normalised by the semantic index. */
export interface PrincipleFinding {
  id: string
  title: string
  message: string
  line: number
  endLine?: number
  /** 0 error, 1 warning, 2 information, 3 hint (the vscode.DiagnosticSeverity order). */
  severity: 0 | 1 | 2 | 3
}

export interface AnalysisInput {
  /** Workspace-relative path with forward slashes. */
  path: string
  content: string
  lines: string[]
  types: ParsedTypeDefinition[]
  schemaTables?: readonly SchemaLike[]
  principleFindings?: readonly PrincipleFinding[]
  /** True when a constant is defined in this project (not a gem or the standard library). */
  isProjectType?: (name: string) => boolean
}

/** A candidate before the collector assigns its id. */
export type CandidateDraft = Omit<Candidate, 'id'>

export interface MethodSite {
  type: ParsedTypeDefinition
  method: ParsedMethod
}

export function buildInput(input: Omit<AnalysisInput, 'lines'>): AnalysisInput {
  return { ...input, lines: input.content.split(/\r?\n/) }
}

export function methodSites(input: AnalysisInput): MethodSite[] {
  return input.types.flatMap(type => type.methods.map(method => ({ type, method })))
}

export function sliceLines(lines: readonly string[], startLine: number, endLine: number): string[] {
  return lines.slice(Math.max(0, startLine - 1), Math.max(0, endLine))
}

export function evidenceAt(path: string, startLine: number, endLine: number, note: string): Evidence {
  return { path, startLine, endLine, note }
}

export function draft(
  kind: CandidateKind,
  input: AnalysisInput,
  fields: {
    startLine: number
    endLine: number
    anchor: Candidate['anchor']
    className?: string
    methodName?: string
    headline: string
    strength: RuleStrength
    severity: 1 | 2 | 3
    metrics: Candidate['metrics']
    evidence: Evidence[]
  },
): CandidateDraft {
  return {
    kind,
    path: input.path,
    ...fields,
  }
}

/** Methods named in the controller's public interface are actions. Private helpers are not. */
export function isControllerPath(path: string): boolean {
  return path.startsWith('app/controllers/')
}

export function isModelPath(path: string): boolean {
  return path.startsWith('app/models/')
}
