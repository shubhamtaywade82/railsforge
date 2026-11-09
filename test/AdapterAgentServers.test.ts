import { describe, expect, it } from 'vitest'
import { AGENT_SERVERS, agentServerPlans } from '../src/adapters/AdapterAgentServers'
import { adapterById } from '../src/adapters/AdapterCatalog'
import type { AdapterReport } from '../src/adapters/AdapterService'
import type { AdapterState } from '../src/adapters/AdapterStatus'

const root = '/app'

function report(id: string, state: AdapterState): AdapterReport {
  return { entry: adapterById(id)!, state }
}

const globalDebug = report('debug-mcp', { kind: 'installed', where: 'global', version: '0.4.0' })

describe('agentServerPlans', () => {
  it('offers debug-mcp when it is enabled, allowed to run code for the agent, and installed globally', () => {
    expect(agentServerPlans({ reports: [globalDebug], enabled: ['debug-mcp'], executionAllowed: ['debug-mcp'], root })).toEqual([
      { adapter: 'debug-mcp', label: 'debug-mcp (RailsForge)', command: 'debug-mcp', args: [], version: '0.4.0' },
    ])
  })

  it('offers nothing without the separate consent to run code for the agent', () => {
    expect(agentServerPlans({ reports: [globalDebug], enabled: ['debug-mcp'], executionAllowed: [], root })).toEqual([])
  })

  it('offers nothing unless the tool is enabled', () => {
    expect(agentServerPlans({ reports: [globalDebug], enabled: [], executionAllowed: ['debug-mcp'], root })).toEqual([])
  })

  it('never offers a project install, which would need the application as its working directory', () => {
    const projectDebug = report('debug-mcp', { kind: 'installed', where: 'project', version: '0.4.0' })
    expect(agentServerPlans({ reports: [projectDebug], enabled: ['debug-mcp'], executionAllowed: ['debug-mcp'], root })).toEqual([])
  })

  it('never offers a tool that is missing, unchecked, or too old for its Ruby', () => {
    const notRunnable: AdapterState[] = [
      { kind: 'missing' },
      { kind: 'unknown', reason: 'untrusted' },
      { kind: 'toolchain-missing', tool: 'gem' },
      { kind: 'ruby-too-old', detected: '3.1.4', required: '3.2.0' },
    ]
    for (const state of notRunnable) {
      expect(
        agentServerPlans({ reports: [report('debug-mcp', state)], enabled: ['debug-mcp'], executionAllowed: ['debug-mcp'], root }),
        state.kind,
      ).toEqual([])
    }
  })

  it('offers only the tools whose stdio start is stated in their README', () => {
    expect(Object.keys(AGENT_SERVERS)).toEqual(['debug-mcp'])
    for (const id of ['rails-mcp-server', 'ruby-console-mcp', 'gems-mcp', 'ask-rails-harness-mcp'] as const) {
      const installed = report(id, { kind: 'installed', where: 'global', version: '1.0.0' })
      expect(agentServerPlans({ reports: [installed], enabled: [id], executionAllowed: [id], root }), id).toEqual([])
    }
  })
})
