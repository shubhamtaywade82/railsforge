/**
 * AgentLoop - a small, bounded tool-use loop on top of any text-completion provider.
 *
 * The model may call read-only RailsForge tools (schema, routes, semantic graph, skills, ...) by replying
 * with a fenced ```tool block; the loop runs the tool, feeds the result back and asks again, until the
 * model answers in prose. Everything is bounded: steps, bytes fed back, per-tool time, repeated calls,
 * and one repair round. Afterwards the final answer's Ruby code blocks are syntax-checked with `ruby -c`
 * and, if broken, the model gets one chance to fix them; whatever still fails is reported, never hidden,
 * and nothing is claimed as verified that was not checked.
 *
 * Pure (no vscode); providers, tools and the syntax checker are injected so it is fully unit-tested.
 */

import { z } from 'zod'
import { SyntaxCheck } from '../util/RubySyntax'

export interface LoopTool {
  name: string
  description: string
  inputSchema: z.ZodRawShape
  run(args: Record<string, unknown>): Promise<string>
}

export type CompleteFn = (system: string, user: string) => Promise<{ success: boolean; response: string }>
export type SyntaxFn = (code: string) => Promise<SyntaxCheck>

export interface AgentLoopOptions {
  /** Tool calls allowed before the model must answer. Default 4. */
  maxSteps?: number
  /** Characters of a single tool result fed back. Default 4000. */
  maxResultChars?: number
  /** Characters of tool output fed back in total. Default 16000. */
  maxTotalToolChars?: number
  /** Per-tool timeout. Default 15000 ms. */
  toolTimeoutMs?: number
  /** Repair rounds after a failed syntax check. Default 1. */
  maxRepairs?: number
  /** Ruby blocks checked per answer. Default 6. */
  maxBlocksChecked?: number
}

export type StopReason = 'final' | 'max-steps' | 'budget' | 'repeat' | 'provider-error'

export interface ToolStep {
  tool: string
  args: Record<string, unknown>
  ok: boolean
  chars: number
}

export interface Verification {
  checked: number
  failed: Array<{ block: number; message: string }>
  repaired: boolean
  /** ruby could not be run, so nothing was checked. */
  unavailable: boolean
}

export interface AgentLoopResult {
  success: boolean
  response: string
  steps: ToolStep[]
  stopped: StopReason
  verification?: Verification
}

export interface AgentLoopInput {
  system: string
  prompt: string
  complete: CompleteFn
  tools: readonly LoopTool[]
  syntax?: SyntaxFn
  options?: AgentLoopOptions
  log?: (message: string) => void
}

const EXHAUSTED = 'I looked things up but could not reach an answer within the tool budget. Please ask again with a narrower question.'

export interface ParsedToolCall {
  name: string
  args: Record<string, unknown>
}

/** First tool call in a response: ```tool {"name": "...", "arguments": {...}} ```; null when the reply is a final answer. */
export function parseToolCall(text: string): ParsedToolCall | { error: string } | null {
  const fenced = /```tool\s*\n?([\s\S]*?)```/.exec(text) ?? (/^\s*```json\s*\n?(\{[\s\S]*?"name"[\s\S]*?\})\s*```/.exec(text))
  if (!fenced) {return null}
  const body = (fenced[1] ?? '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (err) {
    return { error: `The tool call is not valid JSON (${err instanceof Error ? err.message : 'parse error'}). Reply with {"name": "...", "arguments": {...}}.` }
  }
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as { name?: unknown }).name !== 'string') {
    return { error: 'The tool call needs a string "name" and an "arguments" object.' }
  }
  const { name, arguments: args } = parsed as { name: string; arguments?: unknown }
  if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) {
    return { error: '"arguments" must be an object.' }
  }
  return { name, args: (args as Record<string, unknown> | undefined) ?? {} }
}

/** Compact, model-facing description of the available tools and the calling convention. */
export function describeTools(tools: readonly LoopTool[]): string {
  if (tools.length === 0) {return ''}
  const lines = tools.map(t => {
    const json = z.toJSONSchema(z.object(t.inputSchema)) as { properties?: Record<string, { type?: string; enum?: unknown[] }>; required?: string[] }
    const props = Object.entries(json.properties ?? {}).map(([k, v]) => `${k}${(json.required ?? []).includes(k) ? '' : '?'}: ${v.enum ? v.enum.join('|') : v.type ?? 'any'}`)
    const firstSentence = t.description.split(/(?<=\.)\s/)[0]
    return `- ${t.name}(${props.join(', ')}) — ${firstSentence}`
  })
  return [
    'You can look things up in this project with read-only tools. To call one, reply with ONLY a fenced block:',
    '```tool',
    '{"name": "get_schema", "arguments": {"model": "Order"}}',
    '```',
    'You then receive the result. Call at most one tool per reply and only when you need project facts you do not already have; otherwise answer directly. When you have enough, answer in plain prose (no tool block).',
    'Available tools:',
    ...lines,
  ].join('\n')
}

/** A forced final answer must not be a tool call: strip it, and say so if nothing else is left. */
function plainAnswer(text: string): string {
  if (parseToolCall(text) === null) {return text}
  const prose = text.replace(/```(?:tool|json)[\s\S]*?```/g, '').trim()
  return prose ? `${prose}\n\n${EXHAUSTED}` : EXHAUSTED
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max)}\n…[truncated ${text.length - max} characters]`)

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Ruby code blocks worth syntax-checking: tagged ruby/rb, complete (no `...` placeholders), bounded in size. */
export function extractRubyBlocks(markdown: string, limit: number): string[] {
  const blocks: string[] = []
  for (const m of markdown.matchAll(/```(?:ruby|rb)(?::[\w./-]+)?[ \t]*\n([\s\S]*?)```/g)) {
    const code = m[1]
    if (code.trim().length === 0 || code.length > 20_000) {continue}
    if (/^\s*(?:#\s*)?\.\.\.\s*$/m.test(code) || /\.\.\.\s*#?\s*(?:rest|etc|omitted)/i.test(code)) {continue}
    blocks.push(code)
    if (blocks.length >= limit) {break}
  }
  return blocks
}

async function verifyAnswer(answer: string, syntax: SyntaxFn, limit: number): Promise<Verification> {
  const blocks = extractRubyBlocks(answer, limit)
  const failed: Verification['failed'] = []
  let checked = 0
  let unavailable = false
  for (const [index, code] of blocks.entries()) {
    const result = await syntax(code)
    if (result.status === 'unavailable') {unavailable = true; break}
    checked++
    if (result.status === 'error') {failed.push({ block: index + 1, message: result.message.split('\n').slice(0, 3).join(' ').slice(0, 300) })}
  }
  return { checked, failed, repaired: false, unavailable }
}

export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const { complete, tools, log } = input
  const opts = {
    maxSteps: input.options?.maxSteps ?? 4,
    maxResultChars: input.options?.maxResultChars ?? 4000,
    maxTotalToolChars: input.options?.maxTotalToolChars ?? 16_000,
    toolTimeoutMs: input.options?.toolTimeoutMs ?? 15_000,
    maxRepairs: input.options?.maxRepairs ?? 1,
    maxBlocksChecked: input.options?.maxBlocksChecked ?? 6,
  }
  const byName = new Map(tools.map(t => [t.name, t]))
  const system = tools.length > 0 ? `${input.system}\n\n${describeTools(tools)}` : input.system
  const steps: ToolStep[] = []
  const transcript: string[] = []
  const seen = new Set<string>()
  let toolChars = 0
  let stopped: StopReason = 'final'
  let answer = ''

  const user = (extra?: string): string => [input.prompt, ...(transcript.length ? ['', '## Tool results so far', ...transcript] : []), ...(extra ? ['', extra] : [])].join('\n')

  for (let turn = 0; ; turn++) {
    const reply = await complete(system, user())
    if (!reply.success) {return { success: false, response: reply.response, steps, stopped: 'provider-error' }}
    const call = tools.length > 0 ? parseToolCall(reply.response) : null
    if (call === null) {answer = reply.response; break}

    // Out of budget: stop calling tools and ask for the answer with what is known.
    if (turn >= opts.maxSteps || toolChars >= opts.maxTotalToolChars) {
      stopped = turn >= opts.maxSteps ? 'max-steps' : 'budget'
      const final = await complete(system, user('You have used your tool budget. Answer now using only what you already know; do not call tools.'))
      if (!final.success) {return { success: false, response: final.response, steps, stopped: 'provider-error' }}
      answer = plainAnswer(final.response)
      break
    }

    if ('error' in call) {
      transcript.push(`(system) ${call.error}`)
      continue
    }
    const key = `${call.name}:${JSON.stringify(call.args)}`
    const tool = byName.get(call.name)
    if (!tool) {
      transcript.push(`(system) There is no tool named "${call.name}". Available: ${[...byName.keys()].join(', ')}.`)
      steps.push({ tool: call.name, args: call.args, ok: false, chars: 0 })
      continue
    }
    if (seen.has(key)) {
      stopped = 'repeat'
      transcript.push(`(system) You already called ${call.name} with these arguments. Use that result, or answer now.`)
      const final = await complete(system, user('Answer now using the results above; do not call tools again.'))
      if (!final.success) {return { success: false, response: final.response, steps, stopped: 'provider-error' }}
      answer = plainAnswer(final.response)
      break
    }
    seen.add(key)

    const parsed = z.object(tool.inputSchema).safeParse(call.args)
    if (!parsed.success) {
      transcript.push(`(system) Invalid arguments for ${tool.name}: ${parsed.error.issues.map(i => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ')}`)
      steps.push({ tool: tool.name, args: call.args, ok: false, chars: 0 })
      continue
    }

    let result: string
    let ok = true
    try {
      result = await withTimeout(tool.run(parsed.data as Record<string, unknown>), opts.toolTimeoutMs, tool.name)
    } catch (err) {
      ok = false
      result = `Error running ${tool.name}: ${err instanceof Error ? err.message : String(err)}`
    }
    result = clip(result, opts.maxResultChars)
    toolChars += result.length
    steps.push({ tool: tool.name, args: parsed.data as Record<string, unknown>, ok, chars: result.length })
    log?.(`[agent-loop] ${tool.name} -> ${result.length} chars${ok ? '' : ' (error)'}`)
    transcript.push(`### ${tool.name}(${JSON.stringify(parsed.data)})\n${result}`)
  }

  const verification = input.syntax ? await verifyAnswer(answer, input.syntax, opts.maxBlocksChecked) : undefined
  let response = answer
  if (verification && !verification.unavailable && verification.failed.length > 0 && opts.maxRepairs > 0) {
    const problems = verification.failed.map(f => `- Ruby block ${f.block}: ${f.message}`).join('\n')
    const repaired = await complete(system, [
      input.prompt, '', '## Your previous answer', answer, '',
      '## Ruby syntax errors found by `ruby -c`', problems, '',
      'Fix only the syntax errors and return the complete corrected answer. Do not call tools.',
    ].join('\n'))
    if (repaired.success && repaired.response.trim().length > 0) {
      const second = await verifyAnswer(repaired.response, input.syntax!, opts.maxBlocksChecked)
      second.repaired = true
      response = repaired.response
      return finish(response, steps, stopped, second)
    }
  }
  return finish(response, steps, stopped, verification)
}

function finish(response: string, steps: ToolStep[], stopped: StopReason, verification: Verification | undefined): AgentLoopResult {
  let text = response.trim()
  if (verification && !verification.unavailable && verification.checked > 0) {
    if (verification.failed.length === 0) {
      text += `\n\n_Ruby syntax checked with \`ruby -c\`: ${verification.checked} block(s) OK${verification.repaired ? ' (after one automatic fix)' : ''}. This is a syntax check only; behaviour was not run or tested._`
    } else {
      text += `\n\n⚠️ **Syntax check failed** (\`ruby -c\`) for ${verification.failed.map(f => `block ${f.block}`).join(', ')}:\n${verification.failed.map(f => `- ${f.message}`).join('\n')}\nReview those blocks before using them.`
    }
  }
  return { success: true, response: text, steps, stopped, verification }
}
