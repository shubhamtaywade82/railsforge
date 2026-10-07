/**
 * Routing quality on labelled prompts the pack did not write. Three sets with different roles:
 *  - everyday: the development set the router was tuned on;
 *  - holdout:  tuned against once, afterwards (so no longer blind);
 *  - blind:    written after tuning and evaluated once — the honest generalisation number.
 * Thresholds are regression guards set just below the measured values, not claims of perfection.
 */
import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { parseCatalog } from '../src/skills/SkillCatalog'
import { routeSkills, stem } from '../src/skills/SkillRouter'

const fixtures = path.resolve(__dirname, 'fixtures', 'skills')
const catalog = parseCatalog(JSON.parse(fs.readFileSync(path.join(fixtures, 'catalog.json'), 'utf8')))!

interface Case { id: string; prompt: string; expectAny?: string[]; expectNone?: boolean; command?: string; entityKinds?: string[] }
const load = (name: string): Case[] => JSON.parse(fs.readFileSync(path.join(fixtures, `${name}-cases.json`), 'utf8')) as Case[]

function evaluate(cases: Case[]): { top1: number; top4: number; total: number; misses: string[]; falsePositives: string[] } {
  let top1 = 0
  let top4 = 0
  let total = 0
  const misses: string[] = []
  const falsePositives: string[] = []
  for (const c of cases) {
    const routed = routeSkills(catalog, { prompt: c.prompt, command: c.command, entityKinds: c.entityKinds }, { maxSkills: 4 })
      .filter(r => r.role !== 'cross-cutting').map(r => r.id)
    if (c.expectNone) {
      if (routed.length > 0) {falsePositives.push(`${c.id} "${c.prompt}" -> ${routed.join(',')}`)}
      continue
    }
    total++
    const expected = c.expectAny ?? []
    if (expected.includes(routed[0])) {top1++}
    if (expected.some(e => routed.includes(e))) {top4++} else {misses.push(`${c.id} "${c.prompt}" -> ${routed.join(',') || '(nothing)'} (want one of ${expected.join(', ')})`)}
  }
  return { top1, top4, total, misses, falsePositives }
}

describe('stem', () => {
  it.each([
    ['retries', 'retry'], ['emails', 'email'], ['debugging', 'debug'], ['validating', 'validat'], ['queries', 'query'],
    ['class', 'class'], ['process', 'process'], ['caches', 'cach'], ['tests', 'test'],
  ])('%s -> %s', (word, expected) => {
    expect(stem(word)).toBe(expected)
  })
})

describe('routing corpus', () => {
  it('every expected skill exists in the catalog (labels cannot rot silently)', () => {
    for (const set of ['everyday', 'holdout', 'blind']) {
      for (const c of load(set)) {
        for (const id of c.expectAny ?? []) {expect(catalog.skills[id], `${set}/${c.id}: unknown skill ${id}`).toBeDefined()}
      }
    }
  })

  it('everyday prompts: the right skill is in the top 4 for nearly all, first for most', () => {
    const r = evaluate(load('everyday'))
    expect(r.total).toBeGreaterThanOrEqual(80)
    expect(r.top4 / r.total, r.misses.join('\n')).toBeGreaterThanOrEqual(0.96)
    expect(r.top1 / r.total).toBeGreaterThanOrEqual(0.74)
    expect(r.falsePositives, 'nonsense prompts must route nothing').toEqual([])
  })

  it('holdout prompts (tuned against once)', () => {
    const r = evaluate(load('holdout'))
    expect(r.top4 / r.total, r.misses.join('\n')).toBeGreaterThanOrEqual(0.93)
    expect(r.top1 / r.total).toBeGreaterThanOrEqual(0.70)
  })

  it('blind prompts: generalisation floor (measured 83% top-4, 54% top-1)', () => {
    const r = evaluate(load('blind'))
    expect(r.top4 / r.total, r.misses.join('\n')).toBeGreaterThanOrEqual(0.75)
    expect(r.top1 / r.total).toBeGreaterThanOrEqual(0.45)
  })

  it('records why a skill was routed (explainability) for every routed skill', () => {
    for (const c of load('everyday').slice(0, 30)) {
      for (const r of routeSkills(catalog, { prompt: c.prompt, command: c.command, entityKinds: c.entityKinds })) {
        expect(r.reasons.length, `${c.id}/${r.id}`).toBeGreaterThan(0)
      }
    }
  })
})
