/**
 * ClassAnalyzer - class- and module-level candidates: size, method count, hard-wired collaborators,
 * responsibilities spread across collaborators, and callbacks (including callbacks with side effects).
 */

import {
  AnalysisInput,
  CandidateDraft,
  draft,
  evidenceAt,
  isControllerPath,
  sliceLines,
} from './AnalysisContext'
import { codeLines, collaboratorRefs, CALLBACK_RE, EXTERNAL_EFFECT_RE, PERSISTENCE_RE } from './metrics'
import type { ParsedTypeDefinition } from '../../indexer/RubyAstParser'

export const CLASS_THRESHOLDS = {
  largeLines: 250,
  veryLargeLines: 500,
  manyMethods: 15,
  veryManyMethods: 25,
  hardWiredCollaborators: 2,
  responsibilityCollaborators: 4,
  responsibilityMethods: 6,
  callbacks: 4,
  sideEffectCallbacks: 2,
} as const

export function analyzeClasses(input: AnalysisInput): CandidateDraft[] {
  const out: CandidateDraft[] = []
  const isProject = input.isProjectType ?? (() => true)

  for (const type of input.types) {
    const span = type.endLine - type.startLine + 1
    const classBody = sliceLines(input.lines, type.startLine, type.endLine)
    const code = codeLines(classBody).join('\n')
    const where = { startLine: type.startLine, endLine: type.endLine, anchor: 'class' as const, className: type.name }
    const at = (note: string) => [evidenceAt(input.path, type.startLine, type.startLine, note)]

    if (span >= CLASS_THRESHOLDS.largeLines) {
      out.push(draft('class.large', input, {
        ...where,
        headline: `${type.name} spans ${span} lines`,
        strength: 'strong',
        severity: span >= CLASS_THRESHOLDS.veryLargeLines ? 3 : 2,
        metrics: { lines: span },
        evidence: at(`${span} lines from class to end`),
      }))
    }

    const methodCount = type.methods.length
    if (methodCount >= CLASS_THRESHOLDS.manyMethods) {
      out.push(draft('class.many-methods', input, {
        ...where,
        headline: `${type.name} defines ${methodCount} methods`,
        strength: 'strong',
        severity: methodCount >= CLASS_THRESHOLDS.veryManyMethods ? 3 : 2,
        metrics: { methods: methodCount },
        evidence: at(`${methodCount} method definitions`),
      }))
    }

    // Controllers are covered by the Rails analyzer's workflow rule, which knows about actions.
    if (!isControllerPath(input.path)) {
      const { instantiated } = collaboratorRefs(code, isProject)
      if (instantiated.length >= CLASS_THRESHOLDS.hardWiredCollaborators) {
        out.push(draft('class.hard-wired-collaborators', input, {
          ...where,
          headline: `${type.name} creates ${instantiated.join(', ')} directly with .new`,
          strength: 'moderate',
          severity: 2,
          metrics: { instantiated },
          evidence: at(`direct instantiation of ${instantiated.join(', ')}`),
        }))
      }
    }

    const collaborators = collaboratorRefs(code, isProject)
    const allCollaborators = [...new Set([...collaborators.instantiated, ...collaborators.called])].sort()
    if (allCollaborators.length >= CLASS_THRESHOLDS.responsibilityCollaborators && methodCount >= CLASS_THRESHOLDS.responsibilityMethods) {
      out.push(draft('class.many-responsibilities', input, {
        ...where,
        headline: `${type.name} coordinates ${allCollaborators.length} collaborators across ${methodCount} methods`,
        strength: 'moderate',
        severity: 2,
        metrics: { collaborators: allCollaborators, methods: methodCount },
        evidence: at(`collaborators: ${allCollaborators.join(', ')}`),
      }))
    }

    const callbacks = callbackDeclarations(input.lines, type.startLine, type.endLine)
    if (callbacks.length >= CLASS_THRESHOLDS.callbacks) {
      out.push(draft('class.callback-heavy', input, {
        ...where,
        headline: `${type.name} declares ${callbacks.length} lifecycle callbacks`,
        strength: 'moderate',
        severity: 2,
        metrics: { callbacks: callbacks.length },
        evidence: callbacks.map(cb => evidenceAt(input.path, cb.line, cb.line, `${cb.keyword} callback`)),
      }))
    }

    const sideEffects = callbacks.filter(cb => callbackHasSideEffects(cb, input.lines, type))
    if (sideEffects.length >= CLASS_THRESHOLDS.sideEffectCallbacks) {
      out.push(draft('class.side-effect-callbacks', input, {
        ...where,
        headline: `${type.name} runs ${sideEffects.length} side effects from callbacks`,
        strength: 'moderate',
        severity: 2,
        metrics: { callbacks: callbacks.length, sideEffectCallbacks: sideEffects.length },
        evidence: sideEffects.map(cb => evidenceAt(input.path, cb.line, cb.line, `${cb.keyword} callback triggers a side effect`)),
      }))
    }

  }
  return out
}

interface CallbackDeclaration {
  line: number
  keyword: string
  /** Method names referenced as symbols (`after_commit :send_receipt`). */
  symbols: string[]
  /** True for block callbacks (`after_create do ... end`). */
  block: boolean
}

export function callbackDeclarations(lines: readonly string[], startLine: number, endLine: number): CallbackDeclaration[] {
  const found: CallbackDeclaration[] = []
  for (let i = startLine - 1; i < endLine; i++) {
    const raw = lines[i] ?? ''
    if (!CALLBACK_RE.test(raw)) {continue}
    const keyword = raw.trim().split(/\s+/)[0]
    const symbols = [...raw.matchAll(/:([a-z_]\w*[?!]?)/g)].map(m => m[1])
    found.push({ line: i + 1, keyword, symbols, block: /\bdo\s*(\|[^|]*\|)?\s*$|\{\s*(\|[^|]*\|)?\s*$/.test(raw) })
  }
  return found
}

/** A callback has a side effect when the method it names, or the block it opens, performs one. */
function callbackHasSideEffects(cb: CallbackDeclaration, lines: readonly string[], type: ParsedTypeDefinition): boolean {
  const bodies: string[] = []
  for (const symbol of cb.symbols) {
    const method = type.methods.find(m => m.name === symbol)
    if (method) {bodies.push(sliceLines(lines, method.startLine, method.endLine).join('\n'))}
  }
  if (cb.block) {
    const indent = (lines[cb.line - 1] ?? '').search(/\S|$/)
    const block: string[] = []
    for (let i = cb.line; i < type.endLine; i++) {
      const raw = lines[i] ?? ''
      if (raw.trim() === 'end' && raw.search(/\S|$/) === indent) {break}
      block.push(raw)
    }
    bodies.push(block.join('\n'))
  }
  return bodies.some(body => EXTERNAL_EFFECT_RE.test(body) || PERSISTENCE_RE.test(body))
}
