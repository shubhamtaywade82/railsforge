/**
 * Metrics - the measurements the analyzers build candidates from. Pure functions over source text.
 *
 * These are deliberately simple, line-based heuristics. Each one counts something a developer can
 * check by reading the code, and each candidate names the measurement that triggered it, so the
 * evidence is always inspectable. Where a metric is approximate (branch points, nesting), the
 * analyzer that uses it says so in the candidate's headline or confidence.
 */

/** Constants that are language or framework types, never project collaborators. */
export const NON_PROJECT_CONSTANTS: ReadonlySet<string> = new Set([
  'Array', 'Hash', 'String', 'Symbol', 'Integer', 'Float', 'Numeric', 'Time', 'Date', 'DateTime', 'Set', 'Struct',
  'Object', 'Proc', 'Regexp', 'JSON', 'Math', 'ENV', 'Rails', 'Logger', 'Class', 'Module', 'Comparable', 'Enumerable',
  'Kernel', 'BigDecimal', 'Digest', 'SecureRandom', 'URI', 'Net', 'StandardError', 'RuntimeError', 'ArgumentError',
  'ActiveRecord', 'ActiveSupport', 'ActiveModel', 'ApplicationRecord', 'ApplicationController', 'ApplicationJob',
  'ActionController', 'ActionView', 'ActiveJob', 'ActionMailer', 'Thread', 'Mutex', 'Queue', 'File', 'Dir', 'IO',
])

const RECEIVER_KEYWORDS: ReadonlySet<string> = new Set([
  'self', 'params', 'session', 'request', 'response', 'flash', 'cookies', 'helpers', 'super', 'it', 'ENV',
])

export function codeLines(lines: readonly string[]): string[] {
  return lines
    .map(line => line.replace(/^\s*#.*$/, '').replace(/\s+#\s.*$/, '').replace(/\s+$/, ''))
    .filter(line => line.trim() !== '')
}

/** Lines in a method's text (def ... end) that carry a branch point. Modifier forms count too. */
export function branchPoints(lines: readonly string[]): number {
  let count = 0
  for (const line of codeLines(lines)) {
    if (/\b(if|elsif|unless|when|while|until|rescue)\b/.test(line)) {count++}
  }
  return count
}

/**
 * Maximum block nesting inside the body of a method (the `def` itself does not count).
 * Openers: if/unless/case/while/until/begin/for at line start, and `do` / `{ |x|` blocks.
 * Closers: `end` and `}`. Modifier `if`/`unless` (mid-line) never opens a block.
 */
export function nestingDepth(lines: readonly string[]): number {
  let depth = 0
  let max = 0
  for (const line of codeLines(lines)) {
    const trimmed = line.trim()
    if (/^(end|\})\b/.test(trimmed)) {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (/^(if|unless|case|while|until|begin|for)\b/.test(trimmed) || /\bdo(\s*\|[^|]*\|)?\s*$/.test(trimmed) || /\{\s*\|[^|]*\|\s*$/.test(trimmed)) {
      depth++
      if (depth > max) {max = depth}
    }
  }
  return max
}

export function parameterCount(defLine: string): number {
  const match = /^\s*def\s+[\w.?!=]+\s*(?:\(([^)]*)\)|\s([^#\n]*))?/.exec(defLine)
  const raw = (match?.[1] ?? match?.[2] ?? '').trim()
  if (raw === '') {return 0}
  return raw.split(',').filter(part => part.trim() !== '').length
}

/** Distinct lowercase receivers of explicit calls (`order.total`), excluding self and framework request objects. */
export function receiverCalls(text: string): { receivers: string[]; count: number } {
  const receivers = new Set<string>()
  let count = 0
  for (const match of text.matchAll(/(?<![\w.:@$])([a-z_]\w*)\.([a-z_]\w*[?!]?)/g)) {
    if (RECEIVER_KEYWORDS.has(match[1])) {continue}
    receivers.add(match[1])
    count++
  }
  return { receivers: [...receivers].sort(), count }
}

/** Calls on a bare identifier that names one of the class's own methods (implicit self calls). */
export function ownMethodCalls(text: string, methodNames: readonly string[]): number {
  let count = 0
  for (const name of methodNames) {
    const pattern = new RegExp(`(?<![\\w.:@$])${escapeRegExp(name)}\\b(?![?!]?\\s*=)`, 'g')
    count += [...text.matchAll(pattern)].length
  }
  return count
}

/**
 * Project constants the text instantiates (`Foo.new`) or calls (`Foo.call`, `Foo.charge`). Standard
 * library and framework constants are excluded; `isProjectType` narrows the rest (for example to
 * constants the semantic index defines in this project).
 */
export function collaboratorRefs(
  text: string,
  isProjectType: (name: string) => boolean = () => true,
): { instantiated: string[]; called: string[] } {
  const instantiated = new Set<string>()
  const called = new Set<string>()
  for (const match of text.matchAll(/(?<![\w:@$.])([A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*)(?:\.(new|[a-z_]\w*[?!]?))?/g)) {
    const name = match[1]
    if (NON_PROJECT_CONSTANTS.has(name.split('::')[0]) || !isProjectType(name)) {continue}
    if (match[2] === 'new') {instantiated.add(name)}
    else if (match[2]) {called.add(name)}
  }
  return { instantiated: [...instantiated].sort(), called: [...called].sort() }
}

export function countMatches(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return [...text.matchAll(new RegExp(pattern.source, flags))].length
}

export const PERSISTENCE_RE = /\.(?:save!?|create!?|update!?|update_all|destroy!?|delete_all|delete|touch|increment!|decrement!|find_or_create_by!?)\b/
export const EXTERNAL_EFFECT_RE = /\.(?:deliver_later|deliver_now|perform_later|perform_async|enqueue|charge|capture|refund|reserve|notify|publish|send_request|transfer)\b/
export const QUERY_CHAIN_RE = /\.(?:where|joins|order|group|having|select|includes|preload|eager_load|left_joins|pluck|limit|offset|distinct)\b/
export const PRESENTATION_RE = /\b(?:number_to_currency|number_to_percentage|number_with_\w+|link_to|content_tag|image_tag|time_ago_in_words|distance_of_time_in_words|simple_format|pluralize|truncate|raw)\b|\bhelpers\./
export const AUTH_CHECK_RE = /\b(?:authorize!?|authenticate_\w+!?|can\?|cannot\?)|\bcurrent_user\.\w+\?|\bpolicy\(|\badmin\?/
export const CALLBACK_RE = /^\s*(before|after|around)_(?:validation|save|create|update|destroy|commit|rollback|initialize|find|touch)\b/

export interface ConditionalChain {
  discriminator: string
  branches: number
  nonTrivialBranches: number
  /** 0-based index into the method lines where the chain starts. */
  startIndex: number
}

/**
 * The largest group of `if`/`elsif` (or `case`/`when`) branches that compare the same discriminator.
 * A branch is non-trivial when its body has at least two code lines; one-line branches are usually a
 * lookup table in disguise, which is not evidence for a Strategy.
 */
export function longestConditionalChain(lines: readonly string[]): ConditionalChain | undefined {
  const groups = new Map<string, Array<{ index: number; indent: number }>>()
  const caseSubjects: Array<{ subject: string; index: number; indent: number }> = []

  lines.forEach((raw, index) => {
    const indent = raw.length - raw.trimStart().length
    const ifMatch = /^\s*(?:if|elsif)\s+([a-z_][\w.]*)\s*(?:==|===|!=)\s*/.exec(raw)
    if (ifMatch) {
      const list = groups.get(ifMatch[1]) ?? []
      list.push({ index, indent })
      groups.set(ifMatch[1], list)
    }
    const caseMatch = /^\s*case\s+([a-z_][\w.]*)\s*$/.exec(raw)
    if (caseMatch) {caseSubjects.push({ subject: caseMatch[1], index, indent })}
  })

  // Ruby writes `when` at the same indent as its `case`, so the `when`s of one case are the lines at
  // that indent up to the matching `end` at that indent.
  for (const cs of caseSubjects) {
    const whens: Array<{ index: number; indent: number }> = []
    for (let i = cs.index + 1; i < lines.length; i++) {
      const raw = lines[i]
      const indent = raw.length - raw.trimStart().length
      if (raw.trim() !== '' && indent === cs.indent && /^\s*end\b/.test(raw)) {break}
      if (indent === cs.indent && /^\s*when\b/.test(raw)) {whens.push({ index: i, indent })}
    }
    if (whens.length > 0) {
      const list = groups.get(cs.subject) ?? []
      list.push(...whens)
      groups.set(cs.subject, list)
    }
  }

  let best: ConditionalChain | undefined
  for (const [discriminator, branches] of groups) {
    if (branches.length < 2) {continue}
    const sorted = [...branches].sort((a, b) => a.index - b.index)
    const nonTrivial = sorted.filter(branch => branchBodyLength(lines, branch.index, branch.indent) >= 2).length
    const candidate: ConditionalChain = {
      discriminator,
      branches: sorted.length,
      nonTrivialBranches: nonTrivial,
      startIndex: sorted[0].index,
    }
    if (!best || candidate.branches > best.branches) {best = candidate}
  }
  return best
}

/** Code lines in a branch body: from the line after `index` up to the next line at or above its indent. */
function branchBodyLength(lines: readonly string[], index: number, indent: number): number {
  let count = 0
  for (let i = index + 1; i < lines.length; i++) {
    const raw = lines[i]
    if (raw.trim() === '') {continue}
    const lineIndent = raw.length - raw.trimStart().length
    if (lineIndent <= indent) {break}
    if (raw.trim().startsWith('#')) {continue}
    count++
  }
  return count
}

/** Normalised body used to detect identical methods: comments, blanks and indentation removed. */
export function normalisedBody(lines: readonly string[]): string {
  return codeLines(lines).map(line => line.trim()).join('\n')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
