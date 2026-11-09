/**
 * RefactoringAdvisor - the AI half of the pipeline. Two calls, each on an explicit user request:
 *
 *   refine(scope, candidates) -> the model decides on the findings the analyzers measured.
 *       It may recommend ONE validated technique per finding, or skip the finding with a reason.
 *       Priority and confidence come from the measurements; the model cannot change them.
 *
 *   plan(recommendation)      -> the model writes a unified diff over the files the recommendation
 *       lists. ChangePlanner proves it applies, stays in scope and parses before anything is shown.
 *
 * With no findings, or none with a validated technique, refine makes no model call at all.
 */

import { validateDiffPlan, PlannedFile } from '../planning/ChangePlanner'
import { checkAdvisorPath } from '../planning/PathGuard'
import { alternativesFor, selectTechniques } from '../patterns/TechniqueSelector'
import type { Technique } from '../patterns/TechniqueCatalog'
import { confidenceOf, priorityOf, rank, scopeLabel } from '../recommendations/RecommendationBuilder'
import { askWithRepair } from './ModelExchange'
import { RefactoringContextBuilder } from './RefactoringContextBuilder'
import { buildPlanPrompt, buildRefinePrompt, FindingView } from './RefactoringPrompts'
import { parseRefinement, RawDecision } from './ResponseParsers'
import {
  ADVISOR_LIMITS,
  AdvisorCatalog,
  AdvisorIndex,
  AdvisorModel,
  AdvisorResult,
  Candidate,
  describeScope,
  ProposedPlan,
  Recommendation,
  RefactorTarget,
  SourceReader,
  SyntaxVerdict,
} from './types'

export interface AdvisorDeps {
  agent: AdvisorModel
  index: AdvisorIndex
  files: SourceReader
  catalog: AdvisorCatalog
  checkSyntax: (code: string) => Promise<SyntaxVerdict>
  log?: (message: string) => void
}

export interface RefinementResult {
  recommendations: Recommendation[]
  /** Findings the model decided not to act on, with its reason. */
  skipped: Array<{ candidateId: string; reason: string }>
}

export class RefactoringAdvisor {
  private readonly contextBuilder: RefactoringContextBuilder

  constructor(private readonly deps: AdvisorDeps) {
    this.contextBuilder = new RefactoringContextBuilder(deps.index, deps.files, deps.catalog)
  }

  async refine(input: {
    path: string
    content: string
    scope: RefactorTarget
    candidates: readonly Candidate[]
  }): Promise<AdvisorResult<RefinementResult>> {
    const primary = checkAdvisorPath(input.path)
    if (!primary.ok) {return { ok: false, reason: 'unsafe-path', message: primary.message }}

    const findings: FindingView[] = []
    for (const candidate of input.candidates) {
      const selection = selectTechniques(candidate)
      if (selection.valid.length === 0) {continue}
      findings.push({
        candidate,
        valid: selection.valid,
        rejected: selection.rejected.map(r => ({ name: r.technique.name, reason: r.reason })),
      })
    }
    if (findings.length === 0) {
      return { ok: true, value: { recommendations: [], skipped: [] } }
    }

    const context = await this.contextBuilder.build({ relativePath: primary.path, content: input.content, target: input.scope })
    const prompt = buildRefinePrompt({
      path: primary.path,
      scope: input.scope,
      findings,
      context,
      patternNames: this.deps.catalog.listCatalog().map(entry => entry.name),
    })
    this.deps.log?.(`refactoring: refine ${primary.path} (${describeScope(input.scope)}): ${findings.length} finding(s)`)

    return askWithRepair({
      agent: this.deps.agent,
      prompt,
      log: this.deps.log,
      validate: text => this.validateRefinement(text, findings, primary.path),
    })
  }

  async plan(recommendation: Recommendation): Promise<AdvisorResult<ProposedPlan>> {
    const files: PlannedFile[] = []
    let total = 0
    for (const raw of recommendation.affectedFiles) {
      const guard = checkAdvisorPath(raw)
      if (!guard.ok) {return { ok: false, reason: 'unsafe-path', message: guard.message }}
      const before = await this.deps.files.read(guard.path)
      if (before !== undefined) {total += before.length}
      files.push({ path: guard.path, before })
    }

    if (total > ADVISOR_LIMITS.applyMaxChars) {
      return {
        ok: false,
        reason: 'too-large',
        message: `The files this recommendation changes total ${total} characters; the in-editor limit is ${ADVISOR_LIMITS.applyMaxChars}. Raise railsForge.ollama.numCtx for a local model, or make the change in chat.`,
      }
    }

    const prompt = buildPlanPrompt({
      title: recommendation.title,
      technique: recommendation.technique?.name ?? 'none',
      design: recommendation.design,
      steps: recommendation.steps,
      files,
    })
    this.deps.log?.(`refactoring: plan "${recommendation.title}" over ${files.length} file(s), ${total} chars`)

    return askWithRepair({
      agent: this.deps.agent,
      prompt,
      log: this.deps.log,
      validate: text => validateDiffPlan(text, files, this.deps.checkSyntax),
    })
  }

  private validateRefinement(text: string, findings: readonly FindingView[], primaryPath: string): AdvisorResult<RefinementResult> {
    const parsed = parseRefinement(text)
    if (!parsed.ok) {return { ok: false, reason: 'invalid-response', message: parsed.message }}
    if (parsed.value.length === 0) {
      return { ok: false, reason: 'invalid-response', message: 'Decide on every finding: recommend one of its allowed techniques, or skip it with a reason.' }
    }

    const byId = new Map(findings.map(f => [f.candidate.id, f]))
    const decided = new Set<string>()
    const recommendations: Recommendation[] = []
    const skipped: RefinementResult['skipped'] = []

    for (const decision of parsed.value) {
      const finding = byId.get(decision.candidateId)
      if (!finding) {
        return {
          ok: false,
          reason: 'invalid-response',
          message: `"${decision.candidateId}" is not one of the findings. Use only the ids listed under STATIC FINDINGS.`,
        }
      }
      if (decided.has(decision.candidateId)) {continue}
      decided.add(decision.candidateId)

      if (decision.decision === 'skip') {
        skipped.push({ candidateId: decision.candidateId, reason: decision.reason ?? 'no reason given' })
        continue
      }

      const technique = finding.valid.find(t => t.id === decision.technique)
      if (!technique) {
        return {
          ok: false,
          reason: 'invalid-response',
          message: `${decision.candidateId}: technique "${decision.technique ?? ''}" is not allowed for this finding. Allowed: ${finding.valid.map(t => t.id).join(', ')}.`,
        }
      }

      const files = this.checkedFiles(decision, primaryPath)
      if (!files.ok) {return { ok: false, reason: 'unsafe-path', message: files.message }}
      recommendations.push(toRecommendation(finding, technique, decision, files.paths))
    }

    // A finding the model did not mention is not silently recommended; it is recorded as undecided.
    for (const finding of findings) {
      if (!decided.has(finding.candidate.id)) {
        skipped.push({ candidateId: finding.candidate.id, reason: 'the advisor did not decide on this finding' })
      }
    }

    return {
      ok: true,
      value: { recommendations: rank(recommendations.slice(0, ADVISOR_LIMITS.maxRecommendations)), skipped },
    }
  }

  private checkedFiles(decision: RawDecision, primaryPath: string): { ok: true; paths: string[] } | { ok: false; message: string } {
    const paths = [primaryPath]
    for (const raw of decision.affectedFiles) {
      const guard = checkAdvisorPath(raw)
      if (!guard.ok) {return guard}
      if (!paths.includes(guard.path)) {paths.push(guard.path)}
    }
    if (paths.length > ADVISOR_LIMITS.maxFilesPerRecommendation) {
      return { ok: false, message: `${decision.candidateId} lists ${paths.length} files; the limit is ${ADVISOR_LIMITS.maxFilesPerRecommendation}.` }
    }
    return { ok: true, paths }
  }
}

function toRecommendation(finding: FindingView, technique: Technique, decision: RawDecision, files: string[]): Recommendation {
  const c = finding.candidate
  // The model's own alternatives come first; the validated, rejected and keep-as-is options follow from the catalog.
  const alternatives = [
    ...decision.alternatives.map(a => ({ name: a.name, whenBetter: a.whenBetter })),
    ...alternativesFor(selectTechniques(c), technique),
  ]
  const seen = new Set<string>()
  const uniqueAlternatives = alternatives.filter(a => {
    const key = a.name.trim().toLowerCase()
    if (seen.has(key)) {return false}
    seen.add(key)
    return true
  })

  return {
    id: '',
    source: 'ai',
    candidateIds: [c.id],
    path: c.path,
    scope: {
      kind: c.anchor,
      name: c.methodName ?? c.className ?? c.path,
      className: c.className,
      startLine: c.startLine,
      endLine: c.endLine,
    },
    title: `${technique.name}: ${scopeLabel(c)}`,
    problem: c.headline,
    evidence: c.evidence,
    confidence: confidenceOf(c),
    priority: priorityOf(c),
    technique: { id: technique.id, name: technique.name },
    design: decision.design ?? technique.design(c),
    alternatives: uniqueAlternatives,
    benefit: decision.benefit ?? technique.benefit,
    risk: decision.risk ?? technique.risk,
    affectedFiles: files,
    steps: decision.steps.length > 0 ? decision.steps : technique.steps(c),
    verification: decision.verification.length > 0 ? decision.verification : technique.verification(c),
  }
}
