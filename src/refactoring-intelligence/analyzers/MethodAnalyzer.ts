/**
 * MethodAnalyzer - block- and method-level candidates: length, nesting, parameters, mixed
 * responsibilities, long conditional chains, feature envy and complex query chains.
 *
 * Thresholds are conservative on purpose. Each one is a measurement a reviewer would agree is a
 * smell on its own; none of them is evidence for a pattern by itself. Techniques decide whether a
 * candidate justifies a pattern (see patterns/TechniqueCatalog).
 */

import {
  AnalysisInput,
  CandidateDraft,
  draft,
  evidenceAt,
  isControllerPath,
  methodSites,
  sliceLines,
} from './AnalysisContext'
import {
  codeLines,
  collaboratorRefs,
  countMatches,
  longestConditionalChain,
  nestingDepth,
  ownMethodCalls,
  parameterCount,
  PERSISTENCE_RE,
  EXTERNAL_EFFECT_RE,
  QUERY_CHAIN_RE,
} from './metrics'

export const METHOD_THRESHOLDS = {
  longLines: 15,
  veryLongLines: 30,
  deepNesting: 3,
  manyParameters: 4,
  manyCollaborators: 2,
  conditionalBranches: 3,
  queryChain: 4,
  envyCalls: 4,
} as const

export function analyzeMethods(input: AnalysisInput): CandidateDraft[] {
  const out: CandidateDraft[] = []
  const isProject = input.isProjectType ?? (() => true)

  for (const site of methodSites(input)) {
    const { method, type } = site
    const name = method.name
    const body = sliceLines(input.lines, method.startLine, method.endLine)
    const code = codeLines(body)
    const bodyLength = Math.max(0, code.length - 2)
    const where = { startLine: method.startLine, endLine: method.endLine, anchor: 'method' as const, className: type.name, methodName: name }
    const at = (note: string) => [evidenceAt(input.path, method.startLine, method.endLine, note)]

    if (bodyLength >= METHOD_THRESHOLDS.longLines) {
      out.push(draft('method.long', input, {
        ...where,
        headline: `Method ${name} is ${bodyLength} lines long`,
        strength: 'strong',
        severity: bodyLength >= METHOD_THRESHOLDS.veryLongLines ? 3 : 2,
        metrics: { lines: bodyLength },
        evidence: at(`${bodyLength} code lines between def and end`),
      }))
    }

    const depth = nestingDepth(body)
    if (depth >= METHOD_THRESHOLDS.deepNesting) {
      out.push(draft('method.deep-nesting', input, {
        ...where,
        headline: `Method ${name} nests blocks ${depth} levels deep`,
        strength: 'strong',
        severity: depth >= METHOD_THRESHOLDS.deepNesting + 1 ? 3 : 2,
        metrics: { depth },
        evidence: at(`block nesting depth ${depth}`),
      }))
    }

    const params = parameterCount(input.lines[method.startLine - 1] ?? '')
    if (params >= METHOD_THRESHOLDS.manyParameters) {
      out.push(draft('method.many-parameters', input, {
        ...where,
        headline: `Method ${name} takes ${params} parameters`,
        strength: 'strong',
        severity: params >= METHOD_THRESHOLDS.manyParameters + 2 ? 2 : 1,
        metrics: { parameters: params },
        evidence: at(`def line declares ${params} parameters`),
      }))
    }

    const text = code.join('\n')
    const collaborators = collaboratorRefs(text, isProject)
    const allCollaborators = [...new Set([...collaborators.instantiated, ...collaborators.called])].sort()
    const persistence = countMatches(text, PERSISTENCE_RE)
    const effects = countMatches(text, EXTERNAL_EFFECT_RE)
    if (!isControllerPath(input.path) && allCollaborators.length >= METHOD_THRESHOLDS.manyCollaborators && persistence + effects >= 1) {
      out.push(draft('method.mixed-collaborators', input, {
        ...where,
        headline: `Method ${name} coordinates ${allCollaborators.length} collaborators and also persists or triggers side effects`,
        strength: 'moderate',
        severity: 2,
        metrics: { collaborators: allCollaborators, persistenceCalls: persistence, externalEffects: effects },
        evidence: at(`collaborators: ${allCollaborators.join(', ')}`),
      }))
    }

    const chain = longestConditionalChain(body)
    if (chain && chain.branches >= METHOD_THRESHOLDS.conditionalBranches) {
      const chainLine = method.startLine + chain.startIndex
      out.push(draft('method.conditional-chain', input, {
        ...where,
        startLine: chainLine,
        endLine: method.endLine,
        headline: `Method ${name} branches ${chain.branches} times on ${chain.discriminator}`,
        strength: 'moderate',
        severity: 2,
        metrics: {
          discriminator: chain.discriminator,
          discriminatorBranches: chain.branches,
          nonTrivialBranches: chain.nonTrivialBranches,
          branches: chain.branches,
        },
        evidence: [evidenceAt(input.path, chainLine, method.endLine, `${chain.branches} branches compare ${chain.discriminator}; ${chain.nonTrivialBranches} have bodies of two or more lines`)],
      }))
    }

    const envy = featureEnvy(text, type.methods.map(m => m.name), name)
    if (envy) {
      out.push(draft('method.feature-envy', input, {
        ...where,
        headline: `Method ${name} works mostly on ${envy.receiver} (${envy.calls} calls) and little on its own class`,
        strength: 'weak',
        severity: 2,
        metrics: { receivers: [envy.receiver], receiverCalls: envy.calls, ownMethodCalls: envy.ownCalls },
        evidence: at(`${envy.calls} calls on ${envy.receiver}, ${envy.ownCalls} calls to the class's own methods`),
      }))
    }

    const queries = countMatches(text, QUERY_CHAIN_RE)
    if (queries >= METHOD_THRESHOLDS.queryChain) {
      out.push(draft('method.complex-query', input, {
        ...where,
        headline: `Method ${name} builds a query with ${queries} chained relation calls`,
        strength: 'moderate',
        severity: 2,
        metrics: { queryCalls: queries },
        evidence: at(`${queries} query-chain calls (where, joins, order, includes, ...)`),
      }))
    }
  }
  return out
}

/**
 * A method that talks mostly to one foreign object: at least `envyCalls` calls on a single receiver,
 * and no more than one call to the class's own methods. Returns the dominant receiver, or undefined.
 */
export function featureEnvy(
  text: string,
  ownMethodNames: readonly string[],
  methodName: string,
): { receiver: string; calls: number; ownCalls: number } | undefined {
  const perReceiver = new Map<string, number>()
  for (const match of text.matchAll(/(?<![\w.:@$])([a-z_]\w*)\.([a-z_]\w*[?!]?)/g)) {
    if (['self', 'params', 'session', 'request', 'response', 'flash', 'cookies', 'helpers'].includes(match[1])) {continue}
    perReceiver.set(match[1], (perReceiver.get(match[1]) ?? 0) + 1)
  }
  const ownCalls = ownMethodCalls(text.replace(new RegExp(`def\\s+${methodName}\\b`), ''), ownMethodNames)
  let best: { receiver: string; calls: number } | undefined
  for (const [receiver, calls] of perReceiver) {
    if (calls >= METHOD_THRESHOLDS.envyCalls && (!best || calls > best.calls)) {best = { receiver, calls }}
  }
  if (!best || ownCalls > 1) {return undefined}
  return { ...best, ownCalls }
}
