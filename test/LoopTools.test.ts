import { describe, expect, it } from 'vitest'
import { READ_ONLY_LOOP_TOOLS, createLoopTools } from '../src/agent/LoopTools'
import { RAILSFORGE_TOOLS } from '../src/mcp/tools/definitions'
import { ToolContext } from '../src/mcp/tools/ToolContext'
import { writeRailsFixture } from './support/railsFixture'

describe('loop tool allowlist', () => {
  it('names only tools that exist (an allowlist entry cannot silently go stale)', () => {
    const names = new Set(RAILSFORGE_TOOLS.map(t => t.name))
    for (const n of READ_ONLY_LOOP_TOOLS) {expect(names.has(n), n).toBe(true)}
  })

  it('excludes tools that reach the network or the AST database', () => {
    for (const forbidden of ['get_gem_documentation', 'get_offline_docs', 'find_duplicate_methods', 'get_method_notes', 'suggest_learning_resource']) {
      expect(READ_ONLY_LOOP_TOOLS, forbidden).not.toContain(forbidden)
    }
  })

  it('exposes exactly the allowlisted tools, and they run against the project', async () => {
    const root = writeRailsFixture()
    const tools = createLoopTools(new ToolContext(root))
    expect(tools.map(t => t.name).sort()).toEqual([...READ_ONLY_LOOP_TOOLS].sort())
    const schema = await tools.find(t => t.name === 'get_schema')!.run({ model: 'Order' })
    expect(schema).toContain('user_id')
    const context = await tools.find(t => t.name === 'get_semantic_context')!.run({ query: 'OrdersController' })
    expect(context).toContain('OrdersController')
  })

  it('a tool that is not on the allowlist is simply not offered', () => {
    const tools = createLoopTools(new ToolContext(writeRailsFixture()), RAILSFORGE_TOOLS, ['get_schema'])
    expect(tools.map(t => t.name)).toEqual(['get_schema'])
  })
})
