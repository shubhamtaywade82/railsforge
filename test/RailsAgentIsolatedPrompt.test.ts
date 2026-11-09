import { describe, it, expect, vi } from 'vitest'
import { RailsAgent } from '../src/agent/RailsAgent'
import { SchemaIndexer } from '../src/rails/SchemaIndexer'
import { RoutesIndexer } from '../src/rails/RoutesIndexer'

function agentWith(vscodeLmRequest: (system: string, prompt: string) => Promise<string>) {
  const schema = new SchemaIndexer()
  schema.parseSchema('ActiveRecord::Schema.define do\n  create_table "secret_payroll" do |t|\n    t.string "ssn"\n  end\nend\n')
  return new RailsAgent(schema, new RoutesIndexer(), {
    ollamaHost: 'http://localhost:11434',
    model: 'm',
    provider: 'vscode-lm',
    vscodeLmRequest,
    semanticContext: () => 'GRAPH-SECRET',
    skillContext: () => 'SKILL-SECRET',
  })
}

describe('RailsAgent isolated requests with a caller-supplied system prompt', () => {
  it('uses the caller system prompt, and still sends nothing but the prompt from the project', async () => {
    const seen: Array<[string, string]> = []
    const agent = agentWith(vi.fn(async (system: string, prompt: string) => {
      seen.push([system, prompt])
      return 'advice'
    }))

    const result = await agent.run('Refactor this method', {
      isolated: true,
      isolatedSystemPrompt: 'CUSTOM ADVISOR INSTRUCTIONS',
      fileContent: 'FILE-SECRET',
      fileName: 'secret.rb',
      workspaceRoot: '/proj',
    })

    expect(result).toMatchObject({ success: true, response: 'advice' })
    const [system, prompt] = seen[0]
    expect(system).toBe('CUSTOM ADVISOR INSTRUCTIONS')
    expect(prompt).toBe('Refactor this method')
    for (const secret of ['secret_payroll', 'GRAPH-SECRET', 'SKILL-SECRET', 'FILE-SECRET', 'secret.rb']) {
      expect(system).not.toContain(secret)
      expect(prompt).not.toContain(secret)
    }
  })

  it('falls back to the default isolated prompt when no override is given', async () => {
    const seen: string[] = []
    const agent = agentWith(async system => {
      seen.push(system)
      return 'ok'
    })
    await agent.run('Explain a pattern', { isolated: true })
    expect(seen[0]).toContain('RailsForge AI')
    expect(seen[0]).not.toContain('CUSTOM')
  })
})
