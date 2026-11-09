import { describe, expect, it } from 'vitest'
import { ADAPTERS, ADAPTER_IDS, adapterById, isAdapterId } from '../src/adapters/AdapterCatalog'

describe('optional tool catalog', () => {
  it('lists each adapter once, under the ids the settings accept', () => {
    expect(ADAPTERS.map(entry => entry.id).sort()).toEqual([...ADAPTER_IDS].sort())
    expect(new Set(ADAPTERS.map(entry => entry.id)).size).toBe(ADAPTERS.length)
  })

  it('keeps every install step to a package manager or bin/rails, never a hand edit of a file', () => {
    for (const entry of ADAPTERS) {
      for (const plan of entry.installs) {
        for (const step of plan.steps) {
          expect(step, entry.id).toMatch(/^(gem install |npm install -g |bundle add |bin\/rails )/)
        }
        if (plan.scope === 'project') {
          expect(plan.steps.some(step => step.startsWith('bundle add') || step.startsWith('bin/rails')), entry.id).toBe(true)
        } else {
          expect(plan.steps.every(step => step.startsWith('gem install') || step.startsWith('npm install -g')), entry.id).toBe(true)
        }
      }
    }
  })

  it('keeps the requirements that were checked against RubyGems, npm and the READMEs', () => {
    expect(adapterById('rails-mcp-server')?.minimumRuby).toBe('3.3.0')
    expect(adapterById('debug-mcp')?.minimumRuby).toBe('3.2.0')
    expect(adapterById('ask-rails-harness-mcp')?.minimumRuby).toBe('3.2.0')
    expect(adapterById('ask-ruby-harness-mcp')?.minimumRuby).toBe('3.2.0')
    expect(adapterById('actionmcp')?.minimumRuby).toBe('3.4.8')
    expect(adapterById('gems-mcp')?.minimumNode).toBe('18.0.0')
    expect(adapterById('ruby-console-mcp')?.minimumRuby).toBeNull()
  })

  it('classes the tools that evaluate or run arbitrary code as arbitrary-execution', () => {
    expect(adapterById('ruby-console-mcp')?.authority).toBe('arbitrary-execution')
    expect(adapterById('debug-mcp')?.authority).toBe('arbitrary-execution')
    expect(adapterById('ask-rails-harness-mcp')?.authority).toBe('arbitrary-execution')
  })

  it('states the caveats the READMEs and package metadata raise', () => {
    expect(adapterById('actionmcp')?.notes.join(' ')).toContain('STDIO')
    expect(adapterById('gems-mcp')?.notes.join(' ')).toContain('Gemfile edits')
    expect(adapterById('debug-mcp')?.notes.join(' ')).toContain('no authentication')
  })

  it('recognises only catalogued ids', () => {
    expect(isAdapterId('debug-mcp')).toBe(true)
    expect(isAdapterId('run-anything')).toBe(false)
  })
})
