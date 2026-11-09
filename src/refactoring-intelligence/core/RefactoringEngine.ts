/**
 * RefactoringEngine - the deterministic half of the pipeline, with a small cache.
 *
 * CodeLens and the lightbulb call this on every cursor move or edit, so it never calls a model and it
 * never re-analyses a file whose text (and engine facts) have not changed. The AI is reached only
 * through RefactoringAdvisor, on an explicit request.
 */

import type { RubyAstParser } from '../../indexer/RubyAstParser'
import type { SchemaLike } from '../../rails/NPlusOneAnalyzer'
import type { PrincipleFinding } from '../analyzers/AnalysisContext'
import { collectCandidates } from '../analyzers/CandidateCollector'
import { buildDeterministicRecommendations, candidatesInScope } from '../recommendations/RecommendationBuilder'
import type { CrossFileDuplicate } from './CrossFileDuplicates'
import type { Candidate, Recommendation, ScopeRef } from './types'

/** Engine facts supplied by the host. Each is optional; a missing fact disables the rules that need it. */
export interface EngineFacts {
  schemaTables?: () => readonly SchemaLike[]
  principleFindings?: (path: string) => readonly PrincipleFinding[]
  isProjectType?: (name: string) => boolean
  /** Copies of this file's methods in other files, as indexed at the last save. */
  crossFileDuplicates?: (path: string) => readonly CrossFileDuplicate[]
}

const MAX_CACHED_FILES = 32

export class RefactoringEngine {
  private readonly cache = new Map<string, { key: string; candidates: Candidate[] }>()

  constructor(
    private readonly parser: RubyAstParser,
    private readonly facts: EngineFacts = {},
  ) {}

  /** All deterministic candidates for one file, in severity order. */
  candidates(path: string, content: string): Candidate[] {
    const findings = this.facts.principleFindings?.(path) ?? []
    const duplicates = this.facts.crossFileDuplicates?.(path) ?? []
    // The key covers every input to the analysis: the text, the principle findings and the cross-file
    // copies. A change in another file's duplicates therefore reaches this file's cache.
    const key = `${findings.length}:${findings.map(f => `${f.id}@${f.line}`).join(',')}\u0000${JSON.stringify(duplicates)}\u0000${content}`
    const hit = this.cache.get(path)
    if (hit && hit.key === key) {return hit.candidates}

    const candidates = collectCandidates(this.parser, {
      path,
      content,
      schemaTables: this.facts.schemaTables?.(),
      principleFindings: findings,
      isProjectType: this.facts.isProjectType,
      crossFileDuplicates: duplicates,
    })
    this.cache.delete(path)
    this.cache.set(path, { key, candidates })
    while (this.cache.size > MAX_CACHED_FILES) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) {break}
      this.cache.delete(oldest)
    }
    return candidates
  }

  /** Candidates lying entirely inside a scope. */
  candidatesIn(path: string, content: string, scope: ScopeRef): Candidate[] {
    return candidatesInScope(this.candidates(path, content), scope)
  }

  /** Deterministic recommendations for a scope. No model call. */
  recommendations(path: string, content: string, scope: ScopeRef): Recommendation[] {
    return buildDeterministicRecommendations(this.candidatesIn(path, content, scope))
  }

  /** Every deterministic recommendation in the file, unbounded, for editor UI that groups by anchor. */
  allRecommendations(path: string, content: string): Recommendation[] {
    return buildDeterministicRecommendations(this.candidates(path, content), Number.POSITIVE_INFINITY)
  }

  /** Every class and method in the file, as scopes the editor can anchor UI to. */
  scopes(content: string): ScopeRef[] {
    const scopes: ScopeRef[] = []
    for (const type of this.parser.parseTypeDefinitions(content)) {
      scopes.push({ kind: 'class', name: type.name, startLine: type.startLine, endLine: type.endLine })
      for (const method of type.methods) {
        scopes.push({ kind: 'method', name: method.name, className: type.name, startLine: method.startLine, endLine: method.endLine })
      }
    }
    return scopes
  }
}
