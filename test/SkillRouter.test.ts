import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { parseCatalog } from '../src/skills/SkillCatalog'
import { routeSkills, suggestPatterns } from '../src/skills/SkillRouter'

const fixtures = path.resolve(__dirname, 'fixtures', 'skills')
const catalog = parseCatalog(JSON.parse(fs.readFileSync(path.join(fixtures, 'catalog.json'), 'utf8')))!
type RoutingCase = { id: string; prompt: string; primary_skills: string[]; secondary_skills: string[] }
// Cases whose expected primary skills were deliberately not shipped (e.g. React) are out of scope.
const cases = (JSON.parse(fs.readFileSync(path.join(fixtures, 'routing-cases.json'), 'utf8')) as RoutingCase[])
  .filter(c => c.primary_skills.some(p => catalog.skills[p]))

describe('SkillCatalog', () => {
  it('parses the real pack digest and rejects malformed input', () => {
    expect(catalog).toBeDefined()
    expect(Object.keys(catalog.skills).length).toBeGreaterThan(80)
    expect(catalog.defaults.alwaysConsider).toContain('ruby-clean-code')
    expect(parseCatalog({ schema: 2 })).toBeUndefined()
    expect(parseCatalog(null)).toBeUndefined()
  })
})

describe('routeSkills', () => {
  it('routes an N+1 request touching a controller to ActiveRecord/performance skills, plus cross-cutting ones', () => {
    const routed = routeSkills(catalog, { prompt: 'Fix an N+1 query in OrdersController#index', entityKinds: ['controller', 'model'], command: 'optimize' })
    const ids = routed.map(r => r.id)
    expect(ids.slice(0, 4)).toEqual(expect.arrayContaining(['rails-active-record']))
    expect(ids).toContain('rails-performance')
    const crossCutting = routed.filter(r => r.role === 'cross-cutting').map(r => r.id)
    expect(crossCutting).toContain('ruby-clean-code')
    expect(crossCutting).toContain('ruby-tdd-refactoring')
    expect(routed.filter(r => r.role !== 'cross-cutting').length).toBeLessThanOrEqual(4)
  })

  it('is deterministic and respects maxSkills', () => {
    const input = { prompt: 'Add a background job with retries and idempotency for sending emails' }
    expect(routeSkills(catalog, input)).toEqual(routeSkills(catalog, input))
    expect(routeSkills(catalog, input, { maxSkills: 2 }).filter(r => r.role !== 'cross-cutting')).toHaveLength(2)
  })

  it('does not add cross-cutting skills to a pure explanation, nor route nonsense', () => {
    expect(routeSkills(catalog, { prompt: 'explain this associations code', command: 'explain', entityKinds: ['model'] }).some(r => r.role === 'cross-cutting')).toBe(false)
    expect(routeSkills(catalog, { prompt: 'zzz qqq' })).toEqual([])
  })

  it('maps retired ids and records why each skill was chosen', () => {
    const routed = routeSkills(catalog, { prompt: 'write a migration to add an index concurrently', command: 'migrate' })
    expect(routed[0].reasons.length).toBeGreaterThan(0)
    expect(routed.map(r => r.id)).toContain('rails-database-engineering')
  })

  it('suggests patterns from the matrix and from id overlap', () => {
    const patterns = suggestPatterns(catalog, { prompt: 'extract a service object for the checkout workflow' })
    expect(patterns).toContain('service-object')
  })
})

// The pack's cases are adversarial ownership boundaries (authn vs authz, caching vs authorization, ...),
// not keyword tests. At the pinned commit this heuristic router scores 20/25 (top 3) and 21/25 (top 5);
// the thresholds below guard against regressions rather than claim perfection.
describe('routing quality against the pack\'s own routing cases', () => {
  const results = cases.map(c => {
    const routed = routeSkills(catalog, { prompt: c.prompt }, { maxSkills: 5 }).filter(r => r.role !== 'cross-cutting').map(r => r.id)
    return {
      id: c.id,
      primaryHit: c.primary_skills.some(p => routed.slice(0, 3).includes(p)),
      primaryInTop5: c.primary_skills.some(p => routed.includes(p)),
      secondaryRecall: c.secondary_skills.length === 0 ? 1 : c.secondary_skills.filter(s => routed.includes(s)).length / c.secondary_skills.length,
      routed,
    }
  })
  const rate = (f: (r: (typeof results)[number]) => boolean): number => results.filter(f).length / results.length

  it('puts at least one expected primary skill in the top 3 for most cases', () => {
    const misses = results.filter(r => !r.primaryHit).map(r => `${r.id} -> ${r.routed.join(',')}`)
    expect(rate(r => r.primaryHit), `misses:\n${misses.join('\n')}`).toBeGreaterThanOrEqual(0.78)
  })

  it('finds an expected primary in the top 5 for nearly all cases', () => {
    expect(rate(r => r.primaryInTop5)).toBeGreaterThanOrEqual(0.82)
  })
})
