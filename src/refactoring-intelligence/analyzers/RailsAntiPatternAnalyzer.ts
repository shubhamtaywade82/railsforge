/**
 * RailsAntiPatternAnalyzer - Rails-specific candidates: business workflows in controller actions,
 * inline authorization, N+1 reads inside loops, and presentation helpers in models.
 *
 * The N+1 check reuses the existing analyzer (rails/NPlusOneAnalyzer), which needs the application's
 * schema tables. Without tables it reports nothing rather than guessing associations.
 */

import { analyzeNPlusOne } from '../../rails/NPlusOneAnalyzer'
import {
  AnalysisInput,
  CandidateDraft,
  draft,
  evidenceAt,
  isControllerPath,
  isModelPath,
  methodSites,
  sliceLines,
} from './AnalysisContext'
import {
  AUTH_CHECK_RE,
  codeLines,
  collaboratorRefs,
  countMatches,
  EXTERNAL_EFFECT_RE,
  PERSISTENCE_RE,
  PRESENTATION_RE,
} from './metrics'

export function analyzeRails(input: AnalysisInput): CandidateDraft[] {
  const out: CandidateDraft[] = []
  const isProject = input.isProjectType ?? (() => true)

  if (isControllerPath(input.path)) {
    out.push(...controllerWorkflows(input, isProject))
    out.push(...inlineAuthorization(input))
  }
  if (input.schemaTables && input.schemaTables.length > 0) {
    out.push(...nPlusOne(input))
  }
  if (isModelPath(input.path)) {
    out.push(...presentationInModels(input))
  }
  return out
}

function controllerWorkflows(input: AnalysisInput, isProject: (name: string) => boolean): CandidateDraft[] {
  const out: CandidateDraft[] = []
  for (const site of methodSites(input)) {
    const { method, type } = site
    if (!method.isPublic) {continue}
    const text = codeLines(sliceLines(input.lines, method.startLine, method.endLine)).join('\n')
    const refs = collaboratorRefs(text, isProject)
    const collaborators = [...new Set([...refs.instantiated, ...refs.called])].sort()
    const persistence = countMatches(text, PERSISTENCE_RE)
    const effects = countMatches(text, EXTERNAL_EFFECT_RE)
    if (collaborators.length < 2 || persistence + effects < 1) {continue}

    out.push(draft('rails.controller-workflow', input, {
      startLine: method.startLine,
      endLine: method.endLine,
      anchor: 'method',
      className: type.name,
      methodName: method.name,
      headline: `Action ${method.name} runs a ${collaborators.length}-collaborator workflow inside the controller`,
      strength: 'moderate',
      severity: collaborators.length >= 3 ? 3 : 2,
      metrics: { collaborators, persistenceCalls: persistence, externalEffects: effects, instantiated: refs.instantiated },
      evidence: [evidenceAt(input.path, method.startLine, method.endLine, `collaborators: ${collaborators.join(', ')}; ${persistence} persistence call(s), ${effects} external effect(s)`)],
    }))
  }
  return out
}

function inlineAuthorization(input: AnalysisInput): CandidateDraft[] {
  const checks = input.lines.flatMap((raw, index) => (AUTH_CHECK_RE.test(raw) ? [index + 1] : []))
  if (checks.length < 3) {return []}
  return [draft('rails.inline-authorization', input, {
    startLine: input.types[0]?.startLine ?? 1,
    endLine: input.types[0]?.endLine ?? input.lines.length,
    anchor: 'class',
    className: input.types[0]?.name,
    headline: `Authorization is checked inline in ${checks.length} places`,
    strength: 'moderate',
    severity: 2,
    metrics: { authChecks: checks.length },
    evidence: checks.slice(0, 6).map(line => evidenceAt(input.path, line, line, 'inline authorization check')),
  })]
}

function nPlusOne(input: AnalysisInput): CandidateDraft[] {
  const findings = analyzeNPlusOne(input.content, input.schemaTables ?? [])
  return findings.map(finding => {
    const enclosing = methodSites(input).find(s => finding.line >= s.method.startLine && finding.line <= s.method.endLine)
    return draft('rails.n-plus-one', input, {
      startLine: finding.line,
      endLine: Math.max(finding.line, finding.accessLine),
      anchor: 'block',
      className: enclosing?.type.name,
      methodName: enclosing?.method.name,
      headline: `${finding.variable}.${finding.association} is read inside a loop over ${finding.collection}`,
      strength: 'moderate',
      severity: 2,
      metrics: { nPlusOne: { collection: finding.collection, variable: finding.variable, association: finding.association, accessLine: finding.accessLine } },
      evidence: [
        evidenceAt(input.path, finding.line, finding.line, `loop over ${finding.collection}`),
        evidenceAt(input.path, finding.accessLine, finding.accessLine, `${finding.association} read on each ${finding.variable}`),
      ],
    })
  })
}

function presentationInModels(input: AnalysisInput): CandidateDraft[] {
  const out: CandidateDraft[] = []
  for (const site of methodSites(input)) {
    const { method, type } = site
    const text = codeLines(sliceLines(input.lines, method.startLine, method.endLine)).join('\n')
    const calls = countMatches(text, PRESENTATION_RE)
    if (calls < 1) {continue}
    out.push(draft('rails.presentation-in-model', input, {
      startLine: method.startLine,
      endLine: method.endLine,
      anchor: 'method',
      className: type.name,
      methodName: method.name,
      headline: `Model method ${method.name} builds presentation output`,
      strength: 'moderate',
      severity: 1,
      metrics: { presentationCalls: calls },
      evidence: [evidenceAt(input.path, method.startLine, method.endLine, `${calls} view-helper call(s) in a model`)],
    }))
  }
  return out
}
