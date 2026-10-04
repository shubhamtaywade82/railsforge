/**
 * SkillRouter - picks the smallest useful set of skills for a request, combining
 *   1. the pack's own routing matrix and per-skill triggers (text evidence),
 *   2. Rails Semantic Graph entity kinds the request touches (structural evidence),
 *   3. the chat command (/optimize, /migrate, ...),
 * and always appends the pack's cross-cutting skills for implementation work.
 * Deterministic: same input -> same output (ties break on skill id).
 */

import { SkillCatalog } from './SkillCatalog'

export type RouteRole = 'primary' | 'secondary' | 'cross-cutting'

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

const tokens = (text: string): string[] => (text.toLowerCase().match(/[a-z][a-z0-9_+#:./-]*/g) ?? []).filter(t => t.length > 2)
const significant = (text: string): Set<string> => new Set(tokens(text).map(t => t.replace(/[^a-z0-9]/g, '')).filter(t => t.length > 3 && !STOP.has(t)))

function phraseMatches(haystack: string, phrase: string): boolean {
  const p = phrase.toLowerCase().trim()
  if (p.length < 3) {return false}
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(haystack)
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

  // 1a'. weaker evidence: overlap between the request and the skill's description / id words
  for (const [id, skill] of Object.entries(catalog.skills)) {
    const words = significant(`${skill.description} ${id.replace(/-/g, ' ')}`)
    const overlap = [...words].filter(w => textTokens.has(w))
    if (overlap.length >= 2) {bump(id, Math.min(overlap.length * 0.3, 1.5), `description: ${overlap.slice(0, 3).join(', ')}`)}
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

  // 3. chat command
  for (const id of input.command ? COMMAND_SKILLS[input.command] ?? [] : []) {bump(id, 2, `/${input.command}`)}

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, maxSkills)
    .map(([id, v], index): RoutedSkill => ({ id, score: Math.round(v.score * 100) / 100, role: index < 2 ? 'primary' : 'secondary', reasons: v.reasons }))

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
