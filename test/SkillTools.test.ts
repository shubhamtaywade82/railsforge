import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { RAILSFORGE_TOOLS } from '../src/mcp/tools/definitions'
import { ToolContext } from '../src/mcp/tools/ToolContext'
import { writeRailsFixture } from './support/railsFixture'

const packDir = path.resolve(__dirname, 'fixtures', 'skills')
const root = writeRailsFixture()
const ctx = new ToolContext(root, packDir)
const tool = (name: string) => RAILSFORGE_TOOLS.find(t => t.name === name)!
const run = (name: string, input: Record<string, unknown>): Promise<string> => tool(name).handler(ctx, input)

describe('skill tools', () => {
  it('list_skills returns the pack with its source pin and supports a family filter', async () => {
    const all = JSON.parse(await run('list_skills', {})) as { source: { ref: string }; count: number; skills: Array<{ id: string; family: string }> }
    expect(all.source.ref).toBe('dd22f25b435c40e38b28bd5226ef810adf1f4edc')
    expect(all.count).toBeGreaterThan(80)
    const rails = JSON.parse(await run('list_skills', { family: 'rails' })) as { skills: Array<{ family: string }> }
    expect(rails.skills.length).toBeGreaterThan(20)
    expect(rails.skills.every(s => s.family === 'rails')).toBe(true)
  })

  it('route_skills uses the semantic graph: a controller/model task routes to controller + ActiveRecord skills', async () => {
    const out = JSON.parse(await run('route_skills', { task: 'Fix an N+1 query in OrdersController#index', file: 'app/controllers/orders_controller.rb' })) as {
      routed: Array<{ id: string; role: string }>; touches: string[]
    }
    expect(out.touches).toEqual(expect.arrayContaining(['controller']))
    const ids = out.routed.map(r => r.id)
    expect(ids).toContain('rails-action-controller')
    expect(ids).toContain('rails-active-record')
    expect(out.routed.some(r => r.role === 'cross-cutting')).toBe(true)
  })

  it('get_skill: compact by default, full / reference / pattern on request, helpful errors otherwise', async () => {
    const compact = await run('get_skill', { id: 'rails-active-record' })
    expect(compact).toContain('### rails-active-record')
    expect(compact).toContain('References (read with the `reference` argument)')
    expect(compact.length).toBeLessThan(11_000)
    expect((await run('get_skill', { id: 'rails-activerecord', full: true }))).toContain('# Rails Active Record')
    expect(await run('get_skill', { id: 'rails-active-record', reference: 'loading-and-performance.md' })).toContain('Loading strategy')
    expect(await run('get_skill', { pattern: 'service-object' })).toContain('Service Object')
    expect(await run('get_skill', { id: 'nope' })).toContain('No skill named')
    expect(await run('get_skill', {})).toContain('Provide `id`')
    expect(await run('get_skill', { id: 'rails-active-record', reference: '../SKILL.md' })).toContain('no reference')
  })

  it('degrades with clear messages when no pack is installed', async () => {
    const bare = new ToolContext(writeRailsFixture())
    expect(await tool('list_skills').handler(bare, {})).toContain('No skills are available')
    expect(await tool('route_skills').handler(bare, { task: 'x' })).toContain('not bundled')
  })
})

describe('chatSkills contribution', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as {
    contributes: { chatSkills: Array<{ path: string; when?: string }> }
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(packDir, 'catalog.json'), 'utf8')) as { skills: Record<string, unknown> }

  it('only references skills that exist in the pinned pack, at the path the fetch script produces', () => {
    expect(pkg.contributes.chatSkills.length).toBeGreaterThanOrEqual(15)
    for (const entry of pkg.contributes.chatSkills) {
      const m = /^\.\/dist\/skills\/skills\/([\w-]+)\/SKILL\.md$/.exec(entry.path)
      expect(m, entry.path).not.toBeNull()
      expect(catalog.skills[m![1]], `${m![1]} missing from pack`).toBeDefined()
    }
  })
})
