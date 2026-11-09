import { describe, expect, it } from 'vitest'
import { RAILSFORGE_TOOLS } from '../src/mcp/tools/definitions'

const LEVELS = ['R0', 'R1', 'R2', 'R3', 'R4']

// Identifiers that appear only in handlers which start a process, directly or through a helper.
const PROCESS_LAUNCHERS = /RakeTaskIndexer|execFileAsync|spawnProject|RubyCommand|firstCandidate|rubyCandidates|checkRubySyntax|rubySyntaxError|ProjectTerminal/

describe('MCP tool risk metadata', () => {
  it('declares a known risk level for every tool', () => {
    for (const tool of RAILSFORGE_TOOLS) {
      expect(LEVELS, tool.name).toContain(tool.risk)
    }
  })

  it('classifies cached snapshots as R1 and process-launching tools as R2', () => {
    const risk = Object.fromEntries(RAILSFORGE_TOOLS.map(tool => [tool.name, tool.risk]))
    expect(risk.get_runtime_introspection).toBe('R1')
    expect(risk.list_rake_tasks).toBe('R2')
    expect(RAILSFORGE_TOOLS.filter(tool => tool.risk === 'R2').map(tool => tool.name)).toEqual(['list_rake_tasks', 'ruby_check_syntax'])
    expect(risk.ruby_get_symbols).toBe('R0')
    expect(risk.ruby_get_method_details).toBe('R0')
    expect(risk.ruby_check_syntax).toBe('R2')
    expect(risk.ruby_get_project_capabilities).toBe('R0')
  })

  it('never classifies a handler that starts a process below R2', () => {
    for (const tool of RAILSFORGE_TOOLS) {
      if (PROCESS_LAUNCHERS.test(tool.handler.toString())) {
        expect(['R2', 'R3', 'R4'], `${tool.name} starts a process but is declared ${tool.risk}`).toContain(tool.risk)
      }
    }
  })

  it('keeps the existing tool set, so no client loses a tool name', () => {
    expect(RAILSFORGE_TOOLS.map(tool => tool.name)).toHaveLength(23)
  })
})
