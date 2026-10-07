/**
 * SkillRouter - picks the smallest useful set of skills for a request, combining
 *   1. the pack's own routing matrix and per-skill triggers (text evidence),
 *   2. Rails Semantic Graph entity kinds the request touches (structural evidence),
 *   3. the chat command (/optimize, /migrate, ...),
 * and always appends the pack's cross-cutting skills for implementation work.
 * Deterministic: same input -> same output (ties break on skill id).
 */

import { SkillCatalog } from './SkillCatalog'
import { evaluateSafety } from './SafetyRules'

export type RouteRole = 'primary' | 'secondary' | 'cross-cutting' | 'safety'

export interface RoutedSkill {
  id: string
  score: number
  role: RouteRole
  reasons: string[]
}

export interface RouteInput {
  prompt: string
  /** `explain`, `fix`, `service`, ... (chat slash command), if any. */
  command?: string
  /** Entity kinds the request touches (from the semantic graph): controller, model, table, ... */
  entityKinds?: readonly string[]
  /** Extra text that is evidence of intent but not the user's words (diagnostic message, file name). */
  context?: string
}

export interface RouteOptions {
  /** Domain skills (primary + secondary), excluding cross-cutting. Default 4. */
  maxSkills?: number
  alwaysConsider?: readonly string[]
  /** Force-include skills demanded by the deterministic safety rules (default true). */
  safety?: boolean
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'what', 'how', 'why', 'use', 'are', 'not', 'but', 'add', 'make', 'need', 'want', 'should', 'would', 'could', 'please', 'help', 'code', 'file', 'class', 'method', 'rails', 'ruby', 'app', 'change', 'new', 'fix'])

const KIND_SKILLS: Record<string, string[]> = {
  controller: ['rails-action-controller'],
  action: ['rails-action-controller', 'rails-routing'],
  route: ['rails-routing'],
  model: ['rails-active-record'],
  table: ['rails-database-engineering', 'rails-data-modeling'],
  migration: ['rails-database-engineering', 'rails-data-modeling'],
  policy: ['rails-authorization'],
  job: ['rails-active-job'],
  mailer: ['rails-action-mailer'],
  view: ['rails-action-view'],
  partial: ['rails-action-view'],
  spec: ['rails-test-engineering'],
  service: ['ruby-service-objects'],
  query: ['rails-active-record'],
  form: ['rails-active-model'],
}

const COMMAND_SKILLS: Record<string, string[]> = {
  fix: ['ruby-debugging'],
  optimize: ['rails-performance', 'rails-active-record'],
  migrate: ['rails-database-engineering', 'rails-data-modeling'],
  spec: ['rails-test-engineering'],
  service: ['ruby-service-objects'],
  scaffold: ['rails-generators', 'rails-architecture'],
}

/** Light suffix stripping so "retries"/"retry", "emails"/"email", "validating"/"validate" meet. */
export function stem(word: string): string {
  let w = word
  if (w.length > 5 && w.endsWith('ies')) {return `${w.slice(0, -3)}y`}
  if (w.length > 6 && w.endsWith('ing')) {w = w.slice(0, -3)}
  else if (w.length > 5 && w.endsWith('ed')) {w = w.slice(0, -2)}
  else if (w.length > 4 && w.endsWith('es') && /(ss|x|ch|sh)es$/.test(w)) {w = w.slice(0, -2)}
  else if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) {w = w.slice(0, -1)}
  if (w.length > 4 && /([bdgmnprt])\1$/.test(w)) {w = w.slice(0, -1)} // debugg -> debug, stopp -> stop
  if (w.length > 4 && w.endsWith('e')) {w = w.slice(0, -1)}
  return w
}

/** Domain synonyms folded onto the pack's vocabulary (applied to requests and to skill text alike). */
const SYNONYMS: Record<string, string[]> = {
  spec: ['test'], specs: ['test'], rspec: ['test'], minitest: ['test'],
  postmortem: ['incident', 'review'], 'post-mortem': ['incident', 'review'], outage: ['incident'], oncall: ['incident'],
  speed: ['performance'], faster: ['performance'], slow: ['performance'], slower: ['performance'], optimize: ['performance'], optimise: ['performance'], bottleneck: ['performance'],
  vulnerability: ['security'], vulnerabilities: ['security'], exploit: ['security'], injection: ['security'], xss: ['security'], csrf: ['security'],
  upgrade: ['compatibility', 'release'], bump: ['compatibility'], deprecated: ['compatibility'], deprecation: ['compatibility'],
  login: ['authentication'], signin: ['authentication'], password: ['authentication'], permission: ['authorization'], permissions: ['authorization'], role: ['authorization'], roles: ['authorization'],
  email: ['mailer'], emails: ['mailer'], websocket: ['cable'], websockets: ['cable'],
}

/** Multi-word intent phrases folded onto the pack's vocabulary. */
const PHRASE_SYNONYMS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/\bvalue objects?\b|\bmoney (?:amount|type|object)s?\b/, ['domain', 'modeling', 'object']],
  [/\beasier to (?:read|understand)\b|\breadab|\bcleaner\b|\btidy\b|\bclean(?:ing)? up\b|\bsimplif/, ['readability', 'refactor', 'simplicity']],
  [/\bevery (?:night|day|hour|week|morning)\b|\bnightly\b|\bcron\b|\bscheduled?\b|\brecurring\b|\bpurge\b|\bprune\b|\bexpired?\b/, ['maintenance', 'cleanup', 'task']],
  [/\btranslat|\bspanish\b|\bfrench\b|\bgerman\b|\blanguages?\b|\blocali[sz]/, ['i18n', 'translation', 'locale']],
  [/\bonly (?:see|access|view|edit)\b|\btheir own\b|\bown (?:records?|data|invoices?|orders?)\b|\bwho can\b|\bimpersonat/, ['authorization', 'ownership', 'access']],
]

const SHORT_OK = new Set(['api', 'sql', 'xss', 'jwt', 'erb', 'url', 'uri', 'css', 'tls', 'ssl', 'cdn', 'sre', 'rto', 'rpo', 'yjit', 'orm', 'csv', 'xml', 'pdf', 'gem', 'rake', 'i18n'])
const tokens = (text: string): string[] => (text.toLowerCase().match(/[a-z][a-z0-9_+#:./-]*/g) ?? []).filter(t => t.length > 2)
const significant = (text: string): Set<string> => {
  const out = new Set<string>()
  const lowered = text.toLowerCase()
  for (const [pattern, words] of PHRASE_SYNONYMS) {
    if (pattern.test(lowered)) {for (const w of words) {out.add(stem(w))}}
  }
  for (const raw of tokens(text)) {
    const t = raw.replace(/[^a-z0-9-]/g, '')
    if (STOP.has(t)) {continue}
    for (const syn of SYNONYMS[t] ?? []) {out.add(stem(syn))}
    // Exception class names (NoMethodError, ArgumentError, ...) are evidence of a debugging request.
    if (t.length > 5 && t.endsWith('error')) {out.add('exception'); out.add('debug')}
    const plain = t.replace(/-/g, '')
    if (plain.length > 3 || SHORT_OK.has(plain)) {out.add(stem(plain))}
  }
  return out
}

function phraseMatches(haystack: string, phrase: string): boolean {
  const p = phrase.toLowerCase().trim()
  if (p.length < 3) {return false}
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Allow a plural/inflected last word: "flaky test" also matches "flaky tests".
  return new RegExp(`(?<![a-z0-9])${escaped}(?:s|es|ed|ing)?(?![a-z0-9])`).test(haystack)
}

interface DescriptionIndex {
  /** Words from the skill id and trigger phrases: the pack's own vocabulary, weighted higher. */
  strong: Map<string, Set<string>>
  /** Words from the free-text description. */
  weak: Map<string, Set<string>>
  idf: Map<string, number>
}

const indexCache = new WeakMap<SkillCatalog, DescriptionIndex>()

/** Per-skill stemmed word sets plus an inverse-document-frequency weight: a word found in few skills is strong evidence. */
function descriptionIndex(catalog: SkillCatalog): DescriptionIndex {
  const cached = indexCache.get(catalog)
  if (cached) {return cached}
  const strong = new Map<string, Set<string>>()
  const weak = new Map<string, Set<string>>()
  const df = new Map<string, number>()
  for (const [id, skill] of Object.entries(catalog.skills)) {
    const strongSet = significant(`${id.replace(/-/g, ' ')} ${skill.triggers.join(' ')}`)
    const weakSet = significant(skill.description)
    strong.set(id, strongSet)
    weak.set(id, weakSet)
    for (const w of new Set([...strongSet, ...weakSet])) {df.set(w, (df.get(w) ?? 0) + 1)}
  }
  const total = Object.keys(catalog.skills).length
  const idf = new Map<string, number>()
  for (const [w, n] of df) {idf.set(w, Math.log(total / n))}
  const index = { strong, weak, idf }
  indexCache.set(catalog, index)
  return index
}

export function routeSkills(catalog: SkillCatalog, input: RouteInput, options: RouteOptions = {}): RoutedSkill[] {
  const maxSkills = options.maxSkills ?? 4
  const text = `${input.prompt}\n${input.context ?? ''}`.toLowerCase()
  const textTokens = significant(text)
  const scores = new Map<string, { score: number; reasons: string[] }>()
  const bump = (id: string, amount: number, reason: string): void => {
    const resolved = catalog.retired[id] ?? id
    if (!catalog.skills[resolved]) {return}
    const entry = scores.get(resolved) ?? { score: 0, reasons: [] }
    entry.score += amount
    if (!entry.reasons.includes(reason)) {entry.reasons.push(reason)}
    scores.set(resolved, entry)
  }

  // 1a. per-skill trigger phrases (longer phrases are stronger evidence; capped per skill)
  for (const [id, skill] of Object.entries(catalog.skills)) {
    let triggerScore = 0
    const hits: string[] = []
    for (const trigger of skill.triggers) {
      if (phraseMatches(text, trigger)) {
        triggerScore += 1 + 0.4 * (trigger.trim().split(/\s+/).length - 1)
        hits.push(trigger)
      }
    }
    if (triggerScore > 0) {bump(id, Math.min(triggerScore, 6), `trigger: ${hits.slice(0, 3).join(', ')}`)}
  }

  // 1a'. weaker evidence: rarity-weighted overlap between the request and the skill's vocabulary
  // (id/trigger words count 1.5x the description's words)
  const index = descriptionIndex(catalog)
  for (const id of Object.keys(catalog.skills)) {
    const strongHits = [...(index.strong.get(id) ?? [])].filter(w => textTokens.has(w))
    const weakHits = [...(index.weak.get(id) ?? [])].filter(w => textTokens.has(w) && !strongHits.includes(w))
    const weight = strongHits.reduce((sum, w) => sum + 1.5 * (index.idf.get(w) ?? 0), 0) + weakHits.reduce((sum, w) => sum + (index.idf.get(w) ?? 0), 0)
    // One weak (description-only) word is noise ("value" -> hotwire, "read" -> tracker); it needs company.
    const enough = (strongHits.length >= 1 && weight >= 3.2) || (strongHits.length + weakHits.length >= 2 && weight >= 4.5)
    if (enough) {
      bump(id, Math.min(weight * 0.22, 1.8), `description: ${[...strongHits, ...weakHits].slice(0, 3).join(', ')}`)
    }
  }

  // 1b. routing matrix rows the request resembles
  for (const row of catalog.routes) {
    const rowTokens = significant(row.task)
    if (rowTokens.size === 0) {continue}
    const overlap = [...rowTokens].filter(t => textTokens.has(t)).length
    const similarity = overlap / rowTokens.size
    const phrase = phraseMatches(text, row.task) ? 1 : 0
    if (similarity < 0.5 && !phrase) {continue}
    const weight = 2.5 * Math.max(similarity, phrase)
    for (const id of row.primary) {bump(id, weight, `route: ${row.task}`)}
    for (const id of row.secondary) {
      if (!id.startsWith('pattern:')) {bump(id, weight * 0.5, `route: ${row.task}`)}
    }
  }

  // 2. structural evidence from the semantic graph
  for (const kind of new Set(input.entityKinds ?? [])) {
    for (const id of KIND_SKILLS[kind] ?? []) {bump(id, 1.5, `touches ${kind}`)}
  }

  // 2b. stack prior: "Ruby ..." without "Rails" favours the language skills, and vice versa
  const mentionsRuby = /(?<![a-z])ruby(?![a-z])/.test(text)
  const mentionsRails = /(?<![a-z])rails(?![a-z])/.test(text)
  if (mentionsRuby !== mentionsRails) {
    const prefix = mentionsRuby ? 'ruby-' : 'rails-'
    for (const [id, entry] of scores) {
      if (id.startsWith(prefix) && entry.score > 0) {bump(id, 0.7, `${mentionsRuby ? 'Ruby' : 'Rails'} request`)}
    }
  }

  // 3. chat command
  for (const id of input.command ? COMMAND_SKILLS[input.command] ?? [] : []) {bump(id, 2, `/${input.command}`)}

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, maxSkills)
    .map(([id, v], index): RoutedSkill => ({ id, score: Math.round(v.score * 100) / 100, role: index < 2 ? 'primary' : 'secondary', reasons: v.reasons }))

  // Deterministic safety rules add skills regardless of scoring (they never count against maxSkills).
  if (options.safety !== false) {
    for (const finding of evaluateSafety({ prompt: input.prompt, context: input.context })) {
      for (const id of finding.skills) {
        const resolved = catalog.retired[id] ?? id
        if (!catalog.skills[resolved]) {continue}
        const existing = ranked.find(r => r.id === resolved)
        const reason = `safety: ${finding.rule}`
        if (existing) {
          if (!existing.reasons.includes(reason)) {existing.reasons.push(reason)}
        } else {
          ranked.push({ id: resolved, score: 0, role: 'safety', reasons: [reason] })
        }
      }
    }
  }

  // Cross-cutting skills apply to implementation work, not to a pure explanation.
  if (input.command !== 'explain' && ranked.length > 0) {
    for (const id of options.alwaysConsider ?? catalog.defaults.alwaysConsider) {
      if (id === 'stack-minimality' && !scores.has(id)) {continue}
      if (catalog.skills[id] && !ranked.some(r => r.id === id)) {
        ranked.push({ id, score: 0, role: 'cross-cutting', reasons: ['pack default (always consider)'] })
      }
    }
  }
  return ranked
}

/** Pattern ids (from `pattern:<id>` entries of matching matrix rows) plus description-overlap hits. */
export function suggestPatterns(catalog: SkillCatalog, input: RouteInput, limit = 3): string[] {
  const text = `${input.prompt}\n${input.context ?? ''}`.toLowerCase()
  const textTokens = significant(text)
  const ids = new Map<string, number>()
  for (const row of catalog.routes) {
    const rowTokens = significant(row.task)
    const similarity = rowTokens.size ? [...rowTokens].filter(t => textTokens.has(t)).length / rowTokens.size : 0
    if (similarity < 0.5 && !phraseMatches(text, row.task)) {continue}
    for (const sec of row.secondary) {
      if (sec.startsWith('pattern:')) {ids.set(sec.slice(8), (ids.get(sec.slice(8)) ?? 0) + 2 * similarity)}
    }
  }
  for (const family of Object.values(catalog.patterns)) {
    for (const p of family) {
      const idTokens = new Set(p.id.split('-').filter(t => t.length > 3))
      const overlap = [...idTokens].filter(t => textTokens.has(t)).length
      if (overlap >= 2 || (idTokens.size > 0 && overlap === idTokens.size)) {ids.set(p.id, (ids.get(p.id) ?? 0) + overlap)}
    }
  }
  return [...ids.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([id]) => id)
}
