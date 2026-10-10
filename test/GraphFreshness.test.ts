import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { buildSemanticGraph } from '../src/semantic/GraphBuilder'
import { checkFreshness, describeFreshness } from '../src/semantic/Freshness'
import { buildSemanticContext, describeProvenance } from '../src/semantic/RailsContextBuilder'
import { confidenceClass } from '../src/semantic/types'
import { ToolContext } from '../src/mcp/tools/ToolContext'
import { writeRailsFixture } from './support/railsFixture'

const EXCLUDED = new Set(['node_modules', '.git', 'tmp', 'log'])

/** Bumps mtime explicitly so tests never depend on filesystem timestamp granularity. */
function touch(file: string, content: string, mtimeMs: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000)
}

describe('confidenceClass', () => {
  it.each([
    [{ source: 'runtime', confidence: 'runtime' }, 'verified'],
    [{ source: 'schema', confidence: 'static' }, 'declared'],
    [{ source: 'routes', confidence: 'static' }, 'declared'],
    [{ source: 'ast', confidence: 'static' }, 'declared'],
    [{ source: 'source', confidence: 'static' }, 'extracted'],
    [{ source: 'patterns', confidence: 'static' }, 'extracted'],
    [{ source: 'convention', confidence: 'static' }, 'inferred'],
  ] as const)('%j -> %s', (fact, expected) => {
    expect(confidenceClass(fact)).toBe(expected)
  })
})

describe('graph provenance and freshness', () => {
  it('records inputs, including well-known files, and reports an untouched project as fresh', () => {
    const root = writeRailsFixture()
    const graph = buildSemanticGraph(root, { runtimeSnapshot: null, now: () => 1_700_000_000_000 })
    const p = graph.provenance!
    expect(p.builtAt).toBe(1_700_000_000_000)
    expect(p.inputs.map(i => i.path)).toEqual(expect.arrayContaining(['db/schema.rb', 'config/routes.rb', 'app/models/order.rb']))
    expect(p.absent).toEqual(['.railsforge/runtime.json'])
    expect(checkFreshness(p, EXCLUDED)).toMatchObject({ fresh: true, changed: [], added: [], removed: [] })
  })

  it('detects a changed, an added and a removed file — and a well-known file appearing', () => {
    const root = writeRailsFixture()
    const p = buildSemanticGraph(root, { runtimeSnapshot: null }).provenance!

    touch(path.join(root, 'app/models/order.rb'), 'class Order < ApplicationRecord\n  has_many :tags\nend\n', Date.now() + 5_000)
    expect(checkFreshness(p, EXCLUDED)).toMatchObject({ fresh: false, changed: ['app/models/order.rb'] })

    touch(path.join(root, 'app/models/tag.rb'), 'class Tag < ApplicationRecord\nend\n', Date.now())
    expect(checkFreshness(p, EXCLUDED).added).toEqual(['app/models/tag.rb'])

    fs.rmSync(path.join(root, 'app/models/user.rb'))
    expect(checkFreshness(p, EXCLUDED).removed).toEqual(['app/models/user.rb'])

    touch(path.join(root, '.railsforge/runtime.json'), '{"models":[]}', Date.now())
    expect(checkFreshness(p, EXCLUDED).added).toContain('.railsforge/runtime.json')
    expect(describeFreshness(checkFreshness(p, EXCLUDED))).toMatch(/^stale \(1 changed, 2 added, 1 removed\)$/)
  })

  it('ignores files in excluded directories', () => {
    const root = writeRailsFixture()
    const p = buildSemanticGraph(root, { runtimeSnapshot: null }).provenance!
    touch(path.join(root, 'app/node_modules/x/y.rb'), 'class Y; end', Date.now())
    expect(checkFreshness(p, EXCLUDED).fresh).toBe(true)
  })

  it('flags a runtime snapshot older than the schema or a model, and clears once it is refreshed', () => {
    const root = writeRailsFixture()
    const t0 = Date.now() - 60_000
    touch(path.join(root, '.railsforge/runtime.json'), JSON.stringify({ models: [], routes: [], middleware: [] }), t0)
    touch(path.join(root, 'db/schema.rb'), fs.readFileSync(path.join(root, 'db/schema.rb'), 'utf8'), t0 + 30_000)
    const stale = buildSemanticGraph(root).provenance!
    expect(stale).toMatchObject({ hasRuntimeSnapshot: true, runtimeStale: true })
    expect(describeProvenance(stale)).toContain('may be stale')

    touch(path.join(root, '.railsforge/runtime.json'), JSON.stringify({ models: [], routes: [], middleware: [] }), Date.now() + 20_000)
    expect(buildSemanticGraph(root).provenance!.runtimeStale).toBe(false)
  })

  it('marks a graph truncated by the file cap as partial', () => {
    const root = writeRailsFixture()
    const graph = buildSemanticGraph(root, { runtimeSnapshot: null, maxFiles: 3 })
    expect(graph.provenance?.truncated).toBe(true)
    expect(describeProvenance(graph.provenance!)).toContain('partial view')
    expect(describeFreshness(checkFreshness(graph.provenance!, EXCLUDED, 3))).toContain('partial view')
  })

  it('puts the provenance footer and confidence legend into the rendered context', () => {
    const root = writeRailsFixture()
    const graph = buildSemanticGraph(root, { runtimeSnapshot: null, now: () => Date.UTC(2026, 9, 7) })
    const text = buildSemanticContext(graph, { filePath: 'app/models/order.rb' })
    expect(text).toContain('Fact confidence —')
    expect(text).toContain('Graph built 2026-10-07T00:00:00.000Z')
    expect(text).not.toContain('declared = ') // declared is the untagged default, explained in one phrase
  })
})

describe('ToolContext semantic graph caching', () => {
  it('keeps the cached graph while nothing changed and rebuilds exactly when a source file changes', () => {
    const root = writeRailsFixture()
    const ctx = new ToolContext(root)
    const first = ctx.getSemanticGraph(0)
    expect(ctx.getSemanticGraph(0)).toBe(first)

    touch(path.join(root, 'app/models/order.rb'), 'class Order < ApplicationRecord\n  has_one :user\nend\n', Date.now() + 10_000)
    const second = ctx.getSemanticGraph(0)
    expect(second).not.toBe(first)
    expect(second.neighbors('model:Order', { kinds: ['has_one'] })).toHaveLength(1)
    expect(ctx.getSemanticGraph(0)).toBe(second)
  })
})
