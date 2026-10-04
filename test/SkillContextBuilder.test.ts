import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { SkillRegistry } from '../src/skills/SkillRegistry'
import { routeSkills } from '../src/skills/SkillRouter'
import { buildSkillContext, extractSections } from '../src/skills/SkillContextBuilder'

const packDir = path.resolve(__dirname, 'fixtures', 'skills')
const registry = new SkillRegistry({ packDir })

describe('SkillRegistry', () => {
  it('loads the pack, resolves retired ids and reads skill/reference/pattern files', () => {
    expect(registry.available).toBe(true)
    expect(registry.source?.repo).toBe('shubhamtaywade82/ruby-agent-skills')
    expect(registry.get('rails-activerecord')?.id).toBe('rails-active-record')
    expect(registry.readSkill('rails-active-record')).toContain('# Rails Active Record')
    expect(registry.readReference('rails-active-record', 'loading-and-performance.md')).toContain('Loading strategy')
    expect(registry.readPattern('service-object')).toContain('Service Object')
  })

  it('refuses path traversal', () => {
    expect(registry.readSkill('../../etc/passwd')).toBeUndefined()
    expect(registry.readReference('rails-active-record', '../SKILL.md')).toBeUndefined()
    expect(registry.readPattern('../x')).toBeUndefined()
  })

  it('is unavailable (not throwing) without a pack, and merges workspace skills over the pack', () => {
    expect(new SkillRegistry({}).available).toBe(false)
    expect(new SkillRegistry({ packDir: '/nonexistent' }).available).toBe(false)
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-ws-'))
    fs.mkdirSync(path.join(ws, '.agents', 'skills', 'house-style'), { recursive: true })
    fs.writeFileSync(path.join(ws, '.agents', 'skills', 'house-style', 'SKILL.md'), '---\nname: house-style\ndescription: Our naming rules.\n---\n# House style\n## Decision rules\nUse Interactors.\n')
    const merged = new SkillRegistry({ packDir, workspaceRoot: ws })
    expect(merged.get('house-style')).toMatchObject({ origin: 'workspace', description: 'Our naming rules.' })
    expect(merged.readSkill('house-style')).toContain('Use Interactors.')
    expect(merged.list().some(s => s.id === 'rails-active-record')).toBe(true)
    expect(new SkillRegistry({ workspaceRoot: ws }).available).toBe(true)
  })
})

describe('buildSkillContext', () => {
  const input = { prompt: 'Fix an N+1 query in OrdersController#index', entityKinds: ['controller', 'model'], command: 'optimize' }
  const routed = routeSkills(registry.catalog!, input)

  it('injects descriptions, key sections of the primary skills and the best reference, within budget', () => {
    const text = buildSkillContext(registry, routed, input, { maxChars: 6000 })
    expect(text).toContain('## Engineering skills (ruby-agent-skills @dd22f25b)')
    expect(text).toContain('### rails-active-record — primary')
    expect(text).toMatch(/\*\*(Decision rules|Critical invariants)\*\*/)
    expect(text).toContain('### Reference:')
    expect(text).toContain('ruby-clean-code — cross-cutting')
    expect(text.length).toBeLessThanOrEqual(6400)
  })

  it('honours a small budget and returns nothing when there is nothing to say', () => {
    expect(buildSkillContext(registry, routed, input, { maxChars: 1200 }).length).toBeLessThanOrEqual(1600)
    expect(buildSkillContext(registry, [], input)).toBe('')
    expect(buildSkillContext(new SkillRegistry({}), routed, input)).toBe('')
  })

  it('extractSections returns the requested headings in priority order', () => {
    const md = '# T\n## Purpose\np\n## Verification\nv\n## Decision rules\nd\n'
    expect(extractSections(md, ['Decision rules', 'Verification']).map(s => s.heading)).toEqual(['Decision rules', 'Verification'])
  })
})
