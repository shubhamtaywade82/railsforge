import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CompleteFn, LoopTool, SyntaxFn, describeTools, extractRubyBlocks, parseToolCall, runAgentLoop } from '../src/agent/AgentLoop'

const tool = (name: string, run: LoopTool['run'] = async () => `result of ${name}`, inputSchema: z.ZodRawShape = { model: z.string().optional() }): LoopTool => ({ name, description: `Does ${name}. More detail here.`, inputSchema, run })
const call = (name: string, args: object = {}): string => `Let me check.\n\`\`\`tool\n${JSON.stringify({ name, arguments: args })}\n\`\`\``

/** Scripted provider: returns the queued replies in order and records every (system, user) pair. */
function provider(replies: string[]): { complete: CompleteFn; calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = []
  let i = 0
  return {
    calls,
    complete: async (system, user) => {
      calls.push({ system, user })
      return { success: true, response: replies[Math.min(i++, replies.length - 1)] }
    },
  }
}

describe('parseToolCall', () => {
  it('parses a fenced tool call and defaults arguments to {}', () => {
    expect(parseToolCall(call('get_schema', { model: 'Order' }))).toEqual({ name: 'get_schema', args: { model: 'Order' } })
    expect(parseToolCall('```tool\n{"name":"list_routes"}\n```')).toEqual({ name: 'list_routes', args: {} })
  })

  it('treats prose and ordinary code fences as a final answer', () => {
    expect(parseToolCall('Use has_many :orders.')).toBeNull()
    expect(parseToolCall('```ruby\nputs 1\n```')).toBeNull()
  })

  it('reports malformed calls instead of throwing', () => {
    expect(parseToolCall('```tool\n{not json}\n```')).toMatchObject({ error: expect.stringContaining('not valid JSON') })
    expect(parseToolCall('```tool\n{"arguments":{}}\n```')).toMatchObject({ error: expect.stringContaining('"name"') })
    expect(parseToolCall('```tool\n{"name":"x","arguments":[1]}\n```')).toMatchObject({ error: expect.stringContaining('object') })
  })
})

describe('describeTools', () => {
  it('lists name, typed arguments and the first sentence only', () => {
    const text = describeTools([tool('get_schema', undefined, { model: z.string().optional(), kind: z.enum(['a', 'b']) })])
    expect(text).toContain('- get_schema(model?: string, kind: a|b) — Does get_schema.')
    expect(text).not.toContain('More detail')
    expect(describeTools([])).toBe('')
  })
})

describe('runAgentLoop', () => {
  it('answers directly when no tool is needed (one provider call, no tool block sent back)', async () => {
    const p = provider(['Use `has_many :orders`.'])
    const result = await runAgentLoop({ system: 'S', prompt: 'How do I relate users to orders?', complete: p.complete, tools: [tool('get_schema')] })
    expect(result).toMatchObject({ success: true, response: 'Use `has_many :orders`.', stopped: 'final', steps: [] })
    expect(p.calls).toHaveLength(1)
    expect(p.calls[0].system).toContain('Available tools:')
  })

  it('runs a tool, feeds its result back, and returns the final answer', async () => {
    const run = vi.fn(async () => 'orders(id, user_id)')
    const p = provider([call('get_schema', { model: 'Order' }), 'Order belongs_to :user via user_id.'])
    const result = await runAgentLoop({ system: 'S', prompt: 'Describe Order', complete: p.complete, tools: [tool('get_schema', run)] })
    expect(run).toHaveBeenCalledWith({ model: 'Order' })
    expect(result.response).toBe('Order belongs_to :user via user_id.')
    expect(result.steps).toEqual([{ tool: 'get_schema', args: { model: 'Order' }, ok: true, chars: 'orders(id, user_id)'.length }])
    expect(p.calls[1].user).toContain('## Tool results so far')
    expect(p.calls[1].user).toContain('orders(id, user_id)')
  })

  it('stops at maxSteps and forces an answer without tools', async () => {
    const p = provider([call('a', { model: '1' }), call('a', { model: '2' }), call('a', { model: '3' }), 'Final from what I know.'])
    const result = await runAgentLoop({ system: 'S', prompt: 'P', complete: p.complete, tools: [tool('a')], options: { maxSteps: 2 } })
    expect(result.stopped).toBe('max-steps')
    expect(result.response).toBe('Final from what I know.')
    expect(result.steps).toHaveLength(2)
    expect(p.calls.at(-1)!.user).toContain('used your tool budget')
    expect(p.calls.length).toBeLessThanOrEqual(2 + 2)
  })

  it('never returns a raw tool call: a model that insists on tools after the budget gets a safe message', async () => {
    const p = provider([call('a', { model: '1' }), call('a', { model: '2' })])
    const result = await runAgentLoop({ system: 'S', prompt: 'P', complete: p.complete, tools: [tool('a')], options: { maxSteps: 1 } })
    expect(result.response).not.toContain('```tool')
    expect(result.response).toMatch(/tool budget/)
  })

  it('stops when the same call is repeated and asks for the answer', async () => {
    const p = provider([call('a'), call('a'), 'Answer using the first result.'])
    const result = await runAgentLoop({ system: 'S', prompt: 'P', complete: p.complete, tools: [tool('a')] })
    expect(result.stopped).toBe('repeat')
    expect(result.steps).toHaveLength(1)
    expect(result.response).toBe('Answer using the first result.')
  })

  it('enforces the total tool-output budget', async () => {
    const big = tool('a', async () => 'x'.repeat(5000))
    const p = provider([call('a', { model: '1' }), call('a', { model: '2' }), 'Done.'])
    const result = await runAgentLoop({ system: 'S', prompt: 'P', complete: p.complete, tools: [big], options: { maxResultChars: 3000, maxTotalToolChars: 3000 } })
    expect(result.stopped).toBe('budget')
    expect(p.calls[1].user).toContain('[truncated 2000 characters]')
  })

  it('reports unknown tools, bad arguments and malformed calls to the model, within the same step budget', async () => {
    const p = provider([call('nope'), call('a', { model: 5 }), '```tool\n{bad}\n```', 'Gave up on tools.'])
    const result = await runAgentLoop({ system: 'S', prompt: 'P', complete: p.complete, tools: [tool('a')], options: { maxSteps: 3 } })
    expect(result.response).toBe('Gave up on tools.')
    const last = p.calls.at(-1)!.user
    expect(last).toContain('There is no tool named "nope"')
    expect(last).toContain('Invalid arguments for a')
    expect(last).toContain('not valid JSON')
    expect(result.steps.every(s => !s.ok)).toBe(true)
  })

  it('turns tool exceptions and timeouts into text results instead of failures', async () => {
    const boom = tool('boom', async () => { throw new Error('disk on fire') })
    const slow = tool('slow', () => new Promise<string>(() => { /* never resolves */ }))
    const p = provider([call('boom'), call('slow'), 'Handled.'])
    const result = await runAgentLoop({ system: 'S', prompt: 'P', complete: p.complete, tools: [boom, slow], options: { toolTimeoutMs: 20 } })
    expect(result.success).toBe(true)
    expect(result.steps.map(s => s.ok)).toEqual([false, false])
    expect(p.calls.at(-1)!.user).toContain('Error running boom: disk on fire')
    expect(p.calls.at(-1)!.user).toContain('timed out after 20ms')
  })

  it('propagates a provider failure without pretending to have an answer', async () => {
    const result = await runAgentLoop({ system: 'S', prompt: 'P', complete: async () => ({ success: false, response: 'Ollama is offline' }), tools: [tool('a')] })
    expect(result).toMatchObject({ success: false, response: 'Ollama is offline', stopped: 'provider-error' })
  })

  it('works with no tools at all (plain completion)', async () => {
    const p = provider(['Hello.'])
    const result = await runAgentLoop({ system: 'S', prompt: 'P', complete: p.complete, tools: [] })
    expect(result.response).toBe('Hello.')
    expect(p.calls[0].system).toBe('S')
  })
})

describe('verification', () => {
  const ok: SyntaxFn = async () => ({ status: 'ok' })
  const answer = (code: string): string => `Here:\n\`\`\`ruby\n${code}\n\`\`\``

  it('extracts only complete ruby blocks (skips placeholders and other languages)', () => {
    const md = ['```ruby\nclass A; end\n```', '```ruby\nclass B\n  ...\nend\n```', '```erb\n<%= x %>\n```', '```ruby:app/models/c.rb\nclass C; end\n```'].join('\n')
    expect(extractRubyBlocks(md, 6)).toEqual(['class A; end\n', 'class C; end\n'])
    expect(extractRubyBlocks(md, 1)).toHaveLength(1)
  })

  it('states what was checked and what it does not prove', async () => {
    const p = provider([answer('class A; end')])
    const result = await runAgentLoop({ system: 'S', prompt: 'P', complete: p.complete, tools: [], syntax: ok })
    expect(result.verification).toMatchObject({ checked: 1, failed: [], repaired: false })
    expect(result.response).toContain('syntax checked with `ruby -c`: 1 block(s) OK')
    expect(result.response).toContain('behaviour was not run')
  })

  it('asks the model to repair a syntax error once and reports the corrected answer', async () => {
    const syntax: SyntaxFn = async code => (code.includes('def broken') ? { status: 'error', message: 'syntax error, unexpected end-of-input' } : { status: 'ok' })
    const p = provider([answer('def broken'), answer('def fixed; end')])
    const result = await runAgentLoop({ system: 'S', prompt: 'P', complete: p.complete, tools: [], syntax })
    expect(p.calls).toHaveLength(2)
    expect(p.calls[1].user).toContain('Ruby block 1: syntax error, unexpected end-of-input')
    expect(result.response).toContain('def fixed; end')
    expect(result.response).toContain('(after one automatic fix)')
    expect(result.verification).toMatchObject({ checked: 1, failed: [], repaired: true })
  })

  it('does not loop on a model that cannot fix it: reports the failure instead of hiding it', async () => {
    const syntax: SyntaxFn = async () => ({ status: 'error', message: 'still wrong' })
    const p = provider([answer('def a'), answer('def b')])
    const result = await runAgentLoop({ system: 'S', prompt: 'P', complete: p.complete, tools: [], syntax })
    expect(p.calls).toHaveLength(2)
    expect(result.response).toContain('Syntax check failed')
    expect(result.response).toContain('still wrong')
    expect(result.response).not.toContain('block(s) OK')
  })

  it('claims nothing when ruby is unavailable', async () => {
    const p = provider([answer('class A; end')])
    const result = await runAgentLoop({ system: 'S', prompt: 'P', complete: p.complete, tools: [], syntax: async () => ({ status: 'unavailable' }) })
    expect(result.verification).toMatchObject({ checked: 0, unavailable: true })
    expect(result.response).not.toContain('ruby -c')
  })

  it('maxRepairs: 0 reports failures without calling the provider again', async () => {
    const p = provider([answer('def a')])
    const result = await runAgentLoop({ system: 'S', prompt: 'P', complete: p.complete, tools: [], syntax: async () => ({ status: 'error', message: 'bad' }), options: { maxRepairs: 0 } })
    expect(p.calls).toHaveLength(1)
    expect(result.response).toContain('Syntax check failed')
  })
})
