/**
 * CandidateCollector - runs every analyzer over one file and returns candidates with stable ids.
 *
 * Candidates are sorted by severity (then position) and exact duplicates (same kind, same lines)
 * are dropped. The collector is the only entry point the engine uses for deterministic analysis.
 */

import type { RubyAstParser } from '../../indexer/RubyAstParser'
import type { Candidate } from '../core/types'
import { AnalysisInput, buildInput, CandidateDraft } from './AnalysisContext'
import { analyzeClasses } from './ClassAnalyzer'
import { analyzeDuplicates } from './DuplicationAnalyzer'
import { analyzeMethods } from './MethodAnalyzer'
import { analyzePrinciples } from './PrincipleFindingsAdapter'
import { analyzeRails } from './RailsAntiPatternAnalyzer'
import type { SchemaLike } from '../../rails/NPlusOneAnalyzer'
import type { PrincipleFinding } from './AnalysisContext'

export interface CollectInput {
  path: string
  content: string
  schemaTables?: readonly SchemaLike[]
  principleFindings?: readonly PrincipleFinding[]
  isProjectType?: (name: string) => boolean
}

export function collectCandidates(parser: RubyAstParser, input: CollectInput): Candidate[] {
  const analysis: AnalysisInput = buildInput({
    ...input,
    types: parser.parseTypeDefinitions(input.content),
  })
  const drafts: CandidateDraft[] = [
    ...analyzeMethods(analysis),
    ...analyzeClasses(analysis),
    ...analyzeRails(analysis),
    ...analyzeDuplicates(analysis),
    ...analyzePrinciples(analysis),
  ]

  const seen = new Set<string>()
  const unique = drafts.filter(d => {
    const key = `${d.kind}:${d.startLine}:${d.endLine}:${d.methodName ?? ''}`
    if (seen.has(key)) {return false}
    seen.add(key)
    return true
  })

  unique.sort((a, b) => b.severity - a.severity || a.startLine - b.startLine || a.kind.localeCompare(b.kind))
  return unique.map((d, index) => ({ id: `c${index + 1}`, ...d }))
}
