// The text the agent loop shows the model and the user: the calling convention, the parse errors, the answer forced at the
// end of the budget, the clipped tool output, the cancelled and timed-out tools, and the notes added after verification.
// These pin exact text, because both readers depend on it.
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { LoopTool, describeTools, extractRubyBlocks, parseToolCall, runAgentLoop } from '../src/agent/AgentLoop'

const EXHAUSTED = 'I looked things up but could not reach an answer within the tool budget. Please ask again with a narrower question.'
const CALL = '```tool\n{"name":"t","arguments":{"q":"x"}}\n```'
const OK_NOTE = (n: number, repaired: boolean) =>
  `\n\n_Ruby syntax checked with \`ruby -c\`: ${n} block(s) OK${repaired ? ' (after one automatic fix)' : ''}. This is a syntax check only; behaviour was not run or tested._`

const tool = (name: string, run: LoopTool['run'] = async () => 'ok', extra: Partial<LoopTool> = {}): LoopTool => ({
  name, description: 'Reads one thing.', inputSchema: { q: z.string() }, run, ...extra,
})

/** A completion that returns the given replies in order, and records every user prompt it was sent. */
function scripted(replies: string[]): { complete: (system: string, user: string) => Promise<{ success: boolean; response: string }>; prompts: string[] } {
  const prompts: string[] = []
  let next = 0
  const complete = async (_system: string, user: string) => {
    prompts.push(user)
    return { success: true, response: replies[Math.min(next++, replies.length - 1)] }
  }
  return { complete, prompts }
}

describe('describeTools', () => {
  it('shows the calling convention, then each tool with its typed arguments and the first sentence of its description', () => {
    const described = describeTools([{ ...tool('get_schema'), description: 'Reads a model. More detail follows.', inputSchema: { model: z.string(), limit: z.number().optional() } }])
    expect(described).toBe([
      'You can look things up in this project with read-only tools. To call one, reply with ONLY a fenced block:',
      '```tool',
      '{"name": "get_schema", "arguments": {"model": "Order"}}',
      '```',
      'Call at most one tool per reply when you need project facts; otherwise answer directly in plain prose.',
      'Available tools:',
      '- get_schema(model: string, limit?: number) — Reads a model.',
    ].join('\n'))
  })

  it('labels arguments from an outside schema by their enum, their type list, or as any', () => {
    const outside = { ...tool('ext'), description: 'Does it.', jsonSchema: { type: 'object', properties: { mode: { enum: ['a', 'b'] }, tags: { type: ['string', 'null'] }, plain: {} }, required: ['mode'] } }
    expect(describeTools([outside])).toContain('- ext(mode: a|b, tags?: string|null, plain?: any) — Does it.')
  })

  it('describes nothing when there are no tools', () => {
    expect(describeTools([])).toBe('')
  })
})

describe('parseToolCall', () => {
  it('reports a body that is not JSON, and says how to reply', () => {
    expect(parseToolCall('```tool\n{not json}\n```')).toEqual({
      error: expect.stringMatching(/^The tool call is not valid JSON \(.+\)\. Reply with \{"name": "\.\.\.", "arguments": \{\.\.\.\}\}\.$/),
    })
  })

  it('reports a body without a string name, including a body that is null', () => {
    const message = 'The tool call needs a string "name" and an "arguments" object.'
    expect(parseToolCall('```tool\n{"arguments": {}}\n```')).toEqual({ error: message })
    expect(parseToolCall('```tool\n{"name": 3}\n```')).toEqual({ error: message })
    expect(parseToolCall('```tool\nnull\n```')).toEqual({ error: message })
  })

  it('reports arguments that are not an object, and accepts none at all as an empty object', () => {
    expect(parseToolCall('```tool\n{"name":"t","arguments":[1]}\n```')).toEqual({ error: '"arguments" must be an object.' })
    expect(parseToolCall('```tool\n{"name":"t","arguments":null}\n```')).toEqual({ error: '"arguments" must be an object.' })
    expect(parseToolCall('```tool\n{"name":"t"}\n```')).toEqual({ name: 't', args: {} })
  })
})

describe('the budget runs out', () => {
  it('keeps the prose of the forced answer, drops its tool block, and adds the exhausted note', async () => {
    const { complete, prompts } = scripted([CALL, 'Here is what I know.\n```tool\n{"name":"t"}\n```'])
    const result = await runAgentLoop({ system: 'sys', prompt: 'q', complete, tools: [tool('t')], options: { maxSteps: 0 } })
    expect(result).toMatchObject({ success: true, stopped: 'max-steps', response: `Here is what I know.\n\n${EXHAUSTED}` })
    expect(prompts[1]).toContain('You have used your tool budget. Answer now using only what you already know; do not call tools.')
  })

  it('gives only the exhausted note when the forced answer is nothing but a tool block', async () => {
    const { complete } = scripted([CALL, '```tool\n{"name":"t"}\n```'])
    const result = await runAgentLoop({ system: 'sys', prompt: 'q', complete, tools: [tool('t')], options: { maxSteps: 0 } })
    expect(result.response).toBe(EXHAUSTED)
  })
})

describe('what a tool returns to the model', () => {
  it('clips a result at the limit, and says how many characters were cut', async () => {
    const { complete, prompts } = scripted([CALL, 'done'])
    await runAgentLoop({ system: 's', prompt: 'p', complete, tools: [tool('t', async () => 'abcdefghijklmnop')], options: { maxResultChars: 10 } })
    expect(prompts[1]).toContain('abcdefghij\n…[truncated 6 characters]')
  })

  it('reports a tool that outlasts its time limit as an error, naming the tool and the limit', async () => {
    const { complete, prompts } = scripted([CALL, 'done'])
    await runAgentLoop({ system: 's', prompt: 'p', complete, tools: [tool('t', () => new Promise<string>(() => {}))], options: { toolTimeoutMs: 20 } })
    expect(prompts[1]).toContain('Error running t: t timed out after 20ms')
  })

  it('stops at once when the call is cancelled during a tool, and records the tool as cancelled', async () => {
    const controller = new AbortController()
    const { complete } = scripted([CALL, 'done'])
    const pending = runAgentLoop({ system: 's', prompt: 'p', complete, tools: [tool('t', () => new Promise<string>(() => {}))], signal: controller.signal })
    setTimeout(() => controller.abort(), 20)
    const result = await pending
    expect(result).toMatchObject({ success: false, response: 'Cancelled.', stopped: 'cancelled' })
    expect(result.steps).toEqual([expect.objectContaining({ tool: 't', ok: false, code: 'CANCELLED' })])
  })
})

describe('extractRubyBlocks', () => {
  it('takes complete ruby blocks, tagged or not, and skips blank ones, placeholders and oversized ones', () => {
    const answer = [
      '```ruby', 'def ok; end', '```',
      '```rb:app/models/order.rb', 'class Order', 'end', '```',
      '```ruby', '  ', '```',
      '```ruby', 'def more', '  # ...', '```',
      '```ruby', 'foo # ... omitted', '```',
      '```ruby', 'x'.repeat(20_001), '```',
      '```ruby', 'x = 1', '```',
    ].join('\n')
    expect(extractRubyBlocks(answer, 10)).toEqual(['def ok; end\n', 'class Order\nend\n', 'x = 1\n'])
  })

  it('stops at the limit', () => {
    expect(extractRubyBlocks('```ruby\na\n```\n```ruby\nb\n```\n```ruby\nc\n```', 2)).toEqual(['a\n', 'b\n'])
  })
})

describe('verification of the answer', () => {
  const bad = 'Here:\n```ruby\nBAD\n```'
  const fixed = 'Here:\n```ruby\nGOOD\n```'
  const syntax = async (code: string) => (code.includes('BAD')
    ? { status: 'error' as const, message: 'unexpected end\nline two\nline three\nline four' }
    : { status: 'ok' as const })

  it('asks for one repair of a block with a syntax error, and notes the fix when it passes', async () => {
    const { complete, prompts } = scripted([bad, fixed])
    const result = await runAgentLoop({ system: 's', prompt: 'p', complete, tools: [], syntax })
    expect(prompts[1]).toContain('## Ruby syntax errors found by `ruby -c`')
    expect(prompts[1]).toContain('- Ruby block 1: unexpected end line two line three')
    expect(result.response).toBe(`${fixed}${OK_NOTE(1, true)}`)
    expect(result.verification).toMatchObject({ checked: 1, failed: [], repaired: true, unavailable: false })
  })

  it('notes a syntax error that is not repaired, with the first three lines of the message', async () => {
    const { complete } = scripted([bad])
    const result = await runAgentLoop({ system: 's', prompt: 'p', complete, tools: [], syntax, options: { maxRepairs: 0 } })
    expect(result.response).toBe(`${bad}\n\n⚠️ **Syntax check failed** (\`ruby -c\`) for block 1:\n- unexpected end line two line three\nReview those blocks before using them.`)
  })

  it('leaves the answer alone, with no note, when the syntax checker is unavailable', async () => {
    const { complete } = scripted([bad])
    const result = await runAgentLoop({ system: 's', prompt: 'p', complete, tools: [], syntax: async () => ({ status: 'unavailable' as const }) })
    expect(result.response).toBe(bad)
    expect(result.verification).toMatchObject({ unavailable: true })
  })

  it('reports the verifier\'s issues, and asks for a repair under the verification heading', async () => {
    const { complete, prompts } = scripted(['An answer.', 'A better answer.'])
    const result = await runAgentLoop({ system: 's', prompt: 'p', complete, tools: [], verifier: async () => ({ ok: false, issues: ['misses the index'] }) })
    expect(prompts[1]).toContain('## Issues found during verification')
    expect(prompts[1]).toContain('- misses the index')
    expect(prompts[1]).toContain('Fix the issues identified above and return the complete corrected answer.')
    expect(result.response).toBe('A better answer.\n\n⚠️ **Verification issues**:\n- misses the index')
  })

  it('says the check failed when the verifier gives no issue to report', async () => {
    const { complete } = scripted(['An answer.'])
    const result = await runAgentLoop({ system: 's', prompt: 'p', complete, tools: [], verifier: async () => ({ ok: false }), options: { maxRepairs: 0 } })
    expect(result.response).toBe('An answer.\n\n⚠️ **Verification issues**:\n- Verification check failed')
  })
})
