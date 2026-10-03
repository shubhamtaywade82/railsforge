/**
 * RailsAgent - Local LLM Agent for Ruby on Rails engineering
 */

import { SchemaIndexer } from '../rails/SchemaIndexer'
import { RoutesIndexer } from '../rails/RoutesIndexer'
import { ProjectEnvironment, UNKNOWN_VERSION, isKnownVersion } from '../environment/EnvironmentDetector'
import { ProjectPatternIndexer } from '../patterns/ProjectPatternIndexer'

import { OllamaClient } from '@nemesis-oss/ollama-sdk'
import { parseUnifiedDiff } from '../patch/UnifiedDiff'

/** True when `text` carries unified-diff markers, even if it failed to parse as one. */
function looksLikeDiff(text: string): boolean {
  return /^@@ -/m.test(text) || /^--- /m.test(text) || /^\+\+\+ /m.test(text) || /^diff --git /m.test(text)
}

function cleanModelOutput(raw: string): string {
  let cleaned = raw.trim()
  if (/<think>[\s\S]*?<\/think>/.test(cleaned)) {
    const outside = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    cleaned = outside.length > 0 ? outside : cleaned.replace(/<\/?think>/g, '').trim()
  }
  return cleaned.replace(/^```(?:ruby|diff)?\n?/, '').replace(/\n?```$/, '').trim()
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… (truncated, ${text.length} chars total)`
}

function safeJson(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Duplicated (not imported) from config/RailsForgeConfig on purpose — this class stays vscode-free. */
/**
 * - offline: endpoint unreachable
 * - unconfigured: cloud provider without an API key
 * - reachable: Ollama server answered (no auth involved)
 * - authenticated: cloud endpoint reachable and the key (and model, when listed) accepted
 * - error: reachable/configured but unusable (bad key, missing model, HTTP error)
 */
export type ProviderState = 'offline' | 'unconfigured' | 'reachable' | 'authenticated' | 'error'
export interface ProviderStatus {
  state: ProviderState
  detail?: string
}

export type AiAgentProvider = 'ollama' | 'openai' | 'anthropic' | 'vscode-lm'

export interface RailsAgentConfig {
  ollamaHost: string
  model: string
  maxIterations?: number
  /** Defaults to 'ollama' when omitted, preserving the original local-only behavior. */
  provider?: AiAgentProvider
  openaiModel?: string
  /** Base URL for OpenAI-compatible endpoints (OpenAI, OpenRouter, self-hosted vLLM/oss models). */
  openaiBaseUrl?: string
  anthropicModel?: string
  /** Shared sampling/token knobs; applied to whichever provider is active. */
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  /** Add legal-domain safety and drafting guidance to the system prompt. */
  legalMode?: boolean
  /** Ollama-only knobs — ignored (never sent) for cloud providers. */
  ollamaNumCtx?: number
  ollamaKeepAlive?: string
  ollamaRepeatPenalty?: number
  ollamaMinP?: number
  /**
   * Async getter for the provider's API key (backed by vscode.SecretStorage — see
   * extension.ts's `railsforge.setAiApiKey` command). Only consulted for cloud
   * providers; Ollama never needs a key. A cloud provider without a configured key
   * fails `run()` with a clear message instead of sending an unauthenticated request.
   */
  getApiKey?: () => Promise<string | undefined>
  /**
   * 'vscode-lm' only: sends one system+user request through VS Code's Language Model API
   * (`vscode.lm.selectChatModels` / `model.sendRequest`) and resolves with the full text.
   * Injected by the extension so this class stays free of a `vscode` import.
   */
  vscodeLmRequest?: (systemPrompt: string, prompt: string) => Promise<string>
  /** 'vscode-lm' only: reports whether a usable model is available. */
  vscodeLmStatus?: () => Promise<ProviderStatus>
  vscodeLmFamily?: string
  /**
   * Host-provided logging callback (wired in extension.ts to the RailsForge
   * logger) so this class stays vscode-free. 'debug' carries AI request/response
   * summaries and diff-parse results, 'trace' carries raw provider payloads,
   * 'warn' carries model-call failures whose reason would otherwise be swallowed.
   */
  log?: (level: 'debug' | 'trace' | 'warn', message: string) => void
}

export interface RailsAgentContext {
  fileContent?: string
  fileName?: string
  selection?: string
  workspaceRoot?: string
  diagnosticMessage?: string
  isFix?: boolean
}

export interface RailsAgentResult {
  success: boolean
  response: string
  iterations: number
}

/** The model either produced a parseable unified diff, or a snippet replacement. */
export type AiFixProposal =
  | { type: 'patch'; hunks: import('../patch/UnifiedDiff').UnifiedHunk[] }
  | { type: 'snippet'; code: string }

export class RailsAgent {
  constructor(
    private schemaIndexer: SchemaIndexer,
    private routesIndexer: RoutesIndexer,
    private config: RailsAgentConfig,
    private env?: ProjectEnvironment,
    private patternIndexer?: ProjectPatternIndexer,
  ) {}

  updateConfig(newConfig: Partial<RailsAgentConfig>): void {
    this.config = { ...this.config, ...newConfig }
  }

  async run(prompt: string, context: RailsAgentContext): Promise<RailsAgentResult> {
    const startedAt = Date.now()
    const systemPrompt = context.isFix
      ? this.buildFixSystemPrompt(context.diagnosticMessage ?? '', context)
      : this.buildSystemPrompt(context)
    const provider = this.config.provider ?? 'ollama'
    this.log('debug', `[AI] ${provider} request: model=${this.modelFor(provider)}, prompt=${prompt.length} chars, system=${systemPrompt.length} chars`)

    const { success, response } = await this.chatCompletion(systemPrompt, prompt)
    this.log('debug', `[AI] ${provider} response in ${Date.now() - startedAt}ms (${response.length} chars): ${truncate(response, 4000)}`)
    return { success, response, iterations: success ? 1 : 0 }
  }

  private modelFor(provider: AiAgentProvider): string {
    if (provider === 'openai') { return this.config.openaiModel ?? 'gpt-4o-mini' }
    if (provider === 'anthropic') { return this.config.anthropicModel ?? 'claude-sonnet-4-5' }
    if (provider === 'vscode-lm') { return this.config.vscodeLmFamily || 'default (VS Code model picker)' }
    return this.config.model
  }

  private log(level: 'debug' | 'trace' | 'warn', message: string): void {
    this.config.log?.(level, message)
  }

  private async chatCompletion(systemPrompt: string, prompt: string): Promise<{ success: boolean; response: string }> {
    const provider = this.config.provider ?? 'ollama'

    if (provider === 'vscode-lm') {
      if (!this.config.vscodeLmRequest) {
        return { success: false, response: 'The VS Code Language Model API is not available in this editor. Switch railsForge.ai.provider to ollama/openai/anthropic.' }
      }
      try {
        return { success: true, response: await this.config.vscodeLmRequest(systemPrompt, prompt) }
      } catch (err) {
        return { success: false, response: `VS Code language model error: ${err instanceof Error ? err.message : String(err)}` }
      }
    }

    if (provider === 'anthropic') {
      const apiKey = await this.config.getApiKey?.()
      if (!apiKey) {return this.missingApiKeyResult('Anthropic')}
      return this.callAnthropic(systemPrompt, prompt, this.config.anthropicModel ?? 'claude-sonnet-4-5', apiKey)
    }

    if (provider === 'openai') {
      const apiKey = await this.config.getApiKey?.()
      if (!apiKey) {return this.missingApiKeyResult('OpenAI')}
      const rawBaseUrl = this.config.openaiBaseUrl ?? 'https://api.openai.com'
      const baseUrl = rawBaseUrl.replace(/\/$/, '')
      // Reject non-HTTPS URLs unless targeting localhost (for local proxies)
      if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/localhost/i.test(baseUrl) && !/^http:\/\/127\.0\.0\.1/i.test(baseUrl)) {
        return { success: false, response: `Invalid openaiBaseUrl: "${rawBaseUrl}". Must use HTTPS (or http://localhost for local proxies).` }
      }
      return this.callOpenAiCompatible(
        `${baseUrl}/v1/chat/completions`,
        this.config.openaiModel ?? 'gpt-4o-mini',
        systemPrompt,
        prompt,
        apiKey,
        'OpenAI',
      )
    }

    return this.callOllama(systemPrompt, prompt)
  }

  private async callOllama(systemPrompt: string, prompt: string): Promise<{ success: boolean; response: string }> {
    try {
      const client = new OllamaClient({
        baseUrl: this.config.ollamaHost,
        ...(this.config.log
          ? {
            logger: {
              debug: m => this.log('trace', `[Ollama] ${m}`),
              info: m => this.log('trace', `[Ollama] ${m}`),
              warn: m => this.log('trace', `[Ollama] ${m}`),
              error: m => this.log('trace', `[Ollama] ${m}`),
            },
            middleware: [async (ctx) => {
              const res = await ctx.next()
              this.log('trace', `[Ollama] ${ctx.request.method} ${ctx.request.url} -> ${res.status}\n  request: ${truncate(safeJson(ctx.request.body), 8000)}\n  response: ${truncate(safeJson(res.body), 8000)}`)
              return res
            }],
          }
          : {}),
      })
      const chatRes = await client.chat({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        stream: false,
        options: {
          temperature: this.config.temperature ?? 0.2,
          num_predict: this.config.maxTokens ?? 2048,
          num_ctx: this.config.ollamaNumCtx ?? 8192,
          repeat_penalty: this.config.ollamaRepeatPenalty ?? 1.15,
          min_p: this.config.ollamaMinP ?? 0.05,
        },
        keep_alive: this.config.ollamaKeepAlive ?? '30m',
        timeoutMs: this.config.timeoutMs ?? 120000,
      })

      const rawMsg = chatRes.message as unknown as Record<string, unknown> | undefined
      const text = (typeof rawMsg?.content === 'string' && rawMsg.content.trim().length > 0)
        ? rawMsg.content
        : (typeof rawMsg?.thinking === 'string' && rawMsg.thinking.trim().length > 0)
          ? rawMsg.thinking
          : (typeof rawMsg?.reasoning_content === 'string' && rawMsg.reasoning_content.trim().length > 0)
            ? rawMsg.reasoning_content
            : ''

      return { success: true, response: text }
    } catch (err) {
      return { success: false, response: `Failed to connect to local Ollama at ${this.config.ollamaHost}: ${String(err)}` }
    }
  }

  private missingApiKeyResult(providerLabel: string): { success: false; response: string } {
    return {
      success: false,
      response: `No ${providerLabel} API key configured. Run "RailsForge: Set AI Provider API Key" (railsforge.setAiApiKey) first, or switch railsForge.ai.provider back to "ollama".`,
    }
  }

  /** Ollama's /v1/chat/completions and OpenAI's /v1/chat/completions share the same request/response shape. */
  private async callOpenAiCompatible(
    url: string,
    model: string,
    systemPrompt: string,
    prompt: string,
    apiKey: string | undefined,
    connectionLabel: string,
  ): Promise<{ success: boolean; response: string }> {
    try {
      const payload = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.temperature ?? 0.2,
        // Cloud OpenAI-compatible endpoints use max_tokens (not num_predict) and
        // manage context server-side — only the shared knobs apply here.
        max_tokens: this.config.maxTokens ?? 2048,
      }
      this.log('trace', `[${connectionLabel}] request: ${truncate(safeJson(payload), 8000)}`)
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 120000),
      })

      if (!res.ok) {
        return { success: false, response: `${connectionLabel} error: ${res.status} ${res.statusText}` }
      }

      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> }
      const msg = json.choices?.[0]?.message
      const text = (msg?.content && msg.content.trim().length > 0)
        ? msg.content
        : (msg?.reasoning_content && msg.reasoning_content.trim().length > 0)
          ? msg.reasoning_content
          : ''
      this.log('trace', `[${connectionLabel}] response: ${truncate(safeJson(json), 8000)}`)
      return { success: true, response: text }
    } catch (err) {
      return { success: false, response: `Failed to connect to ${connectionLabel}: ${String(err)}` }
    }
  }

  private async callAnthropic(
    systemPrompt: string,
    prompt: string,
    model: string,
    apiKey: string,
  ): Promise<{ success: boolean; response: string }> {
    try {
      const payload = {
        model,
        // Anthropic requires an explicit max_tokens; large cloud models can afford
        // more output than a 4B local model, but the shared cap keeps round time
        // predictable across providers.
        max_tokens: this.config.maxTokens ?? 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.config.temperature ?? 0.2,
      }
      this.log('trace', `[Anthropic] request: ${truncate(safeJson(payload), 8000)}`)
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 120000),
      })

      if (!res.ok) {
        return { success: false, response: `Anthropic error: ${res.status} ${res.statusText}` }
      }

      const json = (await res.json()) as { content?: Array<{ type?: string; text?: string; thinking?: string }> }
      const text = json.content?.find(block => block.type === 'text')?.text
        ?? json.content?.find(block => block.type === 'thinking')?.thinking
        ?? ''
      this.log('trace', `[Anthropic] response: ${truncate(safeJson(json), 8000)}`)
      return { success: true, response: text }
    } catch (err) {
      return { success: false, response: `Failed to connect to Anthropic: ${String(err)}` }
    }
  }

  /**
   * Asks the model to fix `code` (the diagnostic range) so it no longer triggers
   * `diagnosticMessage`. The model is instructed to return a minimal unified diff
   * (git format), which supports fixes spanning several hunks or files precisely.
   * Small local models frequently respond with plain code or a full-file rewrite
   * instead — the model is given one corrective retry demanding a proper diff
   * before falling back to a snippet. `feedback` carries a Ruby syntax error
   * from a previously applied-but-broken proposal so the retry can correct it.
   * Returns null (never throws) when the model is unreachable or the response
   * isn't usable, so callers can show a clean "AI fix unavailable" message.
   */
  async suggestFix(
    code: string,
    diagnosticMessage: string,
    context: RailsAgentContext,
    feedback?: string,
  ): Promise<AiFixProposal | null> {
    let previousResponse: string | null = null

    for (let attempt = 0; attempt < 2; attempt++) {
      const instruction = previousResponse === null
        ? this.buildFixInstruction(code, diagnosticMessage, feedback)
        : this.buildFixRetryInstruction(code, diagnosticMessage, previousResponse)

      const result = await this.run(instruction, context)
      if (!result.success) {
        this.log('warn', `[AI Fix] Model request failed: ${result.response}`)
        return null
      }

      const cleaned = cleanModelOutput(result.response)
      if (!cleaned) {
        this.log('warn', `[AI Fix] Model response was empty on attempt ${attempt + 1}`)
        continue
      }

      const hunks = parseUnifiedDiff(cleaned)
      if (hunks && hunks.length > 0) {
        this.log('debug', `[AI Fix] Parsed unified diff: ${hunks.length} hunk(s)`)
        return { type: 'patch', hunks }
      }

      // A response that LOOKS like a diff but failed to parse is a malformed
      // diff — never treat it as a code snippet (splicing it in would corrupt
      // the file). Retry with format feedback instead.
      if (looksLikeDiff(cleaned)) {
        this.log('debug', `[AI Fix] Response looked like a diff but failed to parse (${cleaned.length} chars) — retrying with format feedback`)
        previousResponse = result.response
        continue
      }

      // Plain code is only salvageable on the last attempt, after the model
      // has had a chance to emit a proper diff.
      if (attempt === 1) {
        const snippet = this.sanitizeSnippetFix(code, cleaned)
        if (snippet) {
          this.log('debug', '[AI Fix] Snippet fallback accepted after diff attempts failed')
          return { type: 'snippet', code: snippet }
        }
      }
      previousResponse = result.response
    }

    return null
  }

  private buildFixInstruction(code: string, diagnosticMessage: string, feedback?: string): string {
    const isDocHeaderFix = !code.includes('\n') && /^(?:class|module)\s+[A-Z]/.test(code.trim()) &&
      /Documentation|documentation/i.test(diagnosticMessage)
    const lines = feedback
      ? [
        `Fix the following issue in the file above: "${diagnosticMessage}".`,
        'Your previous fix was rejected for this reason:',
        feedback,
        'Return a corrected minimal unified diff (git diff format) fixing ONLY this issue.',
      ]
      : [
        `Fix the following issue in the file above: "${diagnosticMessage}".`,
        'Return a minimal unified diff (git diff format) that fixes ONLY this issue.',
      ]
    return lines.concat([
      '- Each hunk starts with a line like: @@ -12,4 +12,5 @@',
      "- Prefix unchanged lines with a single space, removed lines with '-', added lines with '+'.",
      '- Context lines (starting with a single space) MUST exactly match lines from the File Content above — DO NOT invent or modify context lines.',
      '- Line numbers are relative to the File Content above.',
      '- Do not reformat or touch anything unrelated to the issue.',
      isDocHeaderFix
        ? '- CRITICAL: This is a MISSING DOCUMENTATION fix on a CLASS/MODULE header. ' +
          'You must ADD a single comment line ABOVE the class/module header. ' +
          'DO NOT replace the header line. DO NOT comment out any existing code. ' +
          'DO NOT touch validations, methods, or the class body. DO NOT add `frozen_string_literal`. ' +
          'The diff MUST contain EXACTLY ONE hunk with 2-3 context lines.'
        : '- Follow SOLID/DRY/YAGNI/KISS and this project\'s existing patterns.',
      '',
      'DIFF FORMAT EXAMPLES:',
      '',
      'CORRECT (minimal doc fix — ADD one comment line above the class):',
      '--- a/app/models/product.rb',
      '+++ b/app/models/product.rb',
      '@@ -12,3 +12,4 @@',
      ' class Product < ApplicationRecord',
      '+# Top-level documentation for Product.',
      '   validates :sku, presence: true',
      '',
      'WRONG — DO NOT DO THESE:',
      '- Do NOT write multiple hunks — ONE hunk only.',
      '- Do NOT comment out or replace existing lines (no `-` lines unless removing).',
      '- Do NOT touch validations, methods, or the class body.',
      '- Do NOT add `frozen_string_literal: true` unless the issue is about that.',
      '- Do NOT miscount lines in the @@ header — the parser counts actual prefixed lines.',
      '- Do NOT include `--- a/` or `+++ b/` without a space after the dashes.',
      '- Do NOT invent context lines — they MUST exist in the File Content above.',
      '',
      'The File Content above is READ-ONLY context, not something you can edit — but if a sibling method there ' +
        'shares this exact resource/pattern (e.g. both open the same kind of connection), your fix must stay ' +
        'consistent with it. Do not introduce a convention (like an injectable instance variable) in this snippet ' +
        'that the sibling method would then be missing.',
      'Never close, disconnect, or otherwise release an object this snippet did not itself create — if the object ' +
        'may have been supplied by the caller (e.g. via an instance variable), ownership isn\'t yours to end.',
      'Respond with ONLY the diff. No explanation, no markdown code fences.',
      '',
      code,
    ]).join('\n')
  }

private buildFixRetryInstruction(code: string, diagnosticMessage: string, previousResponse: string): string {
    const isDocHeaderFix = !code.includes('\n') && /^(?:class|module)\s+[A-Z]/.test(code.trim()) &&
      /Documentation|documentation/i.test(diagnosticMessage)
    return [
      `The issue to fix: "${diagnosticMessage}".`,
      'Your previous response was not a valid unified diff, so it could not be applied.',
      'Return a minimal unified diff (git format) that fixes ONLY this issue.',
      isDocHeaderFix
        ? 'CRITICAL: This is a MISSING DOCUMENTATION fix on a CLASS/MODULE header. ' +
          'You must ADD a single comment line ABOVE the class/module header. ' +
          'DO NOT replace the header line. DO NOT comment out any existing code. ' +
          'DO NOT touch validations, methods, or the class body. DO NOT add `frozen_string_literal`. ' +
          'The diff MUST contain EXACTLY ONE hunk with 2-3 context lines. ' +
          'Context lines (starting with space) MUST EXACTLY MATCH the File Content — do not invent them.'
        : '',
      'DIFF FORMAT EXAMPLES:',
      '',
      'CORRECT (minimal doc fix — ADD one comment line above the class):',
      '--- a/app/models/product.rb',
      '+++ b/app/models/product.rb',
      '@@ -12,3 +12,4 @@',
      ' class Product < ApplicationRecord',
      '+# Top-level documentation for Product.',
      '   validates :sku, presence: true',
      '',
      'WRONG — DO NOT DO THESE:',
      '- Do NOT write multiple hunks — ONE hunk only.',
      '- Do NOT comment out or replace existing lines (no `-` lines unless removing).',
      '- Do NOT touch validations, methods, or the class body.',
      '- Do NOT add `frozen_string_literal: true` unless the issue is about that.',
      '- Do NOT miscount lines in the @@ header — the parser counts actual prefixed lines.',
      '- Do NOT include `--- a/` or `+++ b/` without a space after the dashes.',
      '- Do NOT invent context lines — they MUST exist in the File Content above.',
      '',
      'The diff must be in EXACTLY this format:',
      '```',
      '--- a/<file path>',
      '+++ b/<file path>',
      '@@ -<oldStart>,<oldCount> +<newStart>,<newCount> @@',
      ' <context line>',
      '-<removed line>',
      '+<added line>',
      '```',
      '- Context lines start with a single space and must match the file verbatim.',
      '- Line numbers are relative to the File Content above.',
      '- Do not reformat or touch anything unrelated to the issue.',
      isDocHeaderFix
        ? '- For this documentation fix: ONLY add comment line(s). No class body. No `end`.'
        : 'Follow SOLID/DRY/YAGNI/KISS and this project\'s existing patterns.',
      'The File Content above is READ-ONLY context — if a sibling method there shares this exact resource/pattern, ' +
        'your fix must stay consistent with it.',
      'Never close, disconnect, or otherwise release an object this snippet did not itself create.',
      'Respond with ONLY the diff. No explanation, no code fences, no commentary.',
      '',
      'Your previous (rejected) response:',
      previousResponse.slice(0, 2000),
      '',
      code,
    ].filter(Boolean).join('\n')
  }

  /**
   * Turns a non-diff model response into a safe snippet replacement. Rejects
   * hallucinated full-file rewrites, and for a single-line class/module header
   * keeps only the comment/header portion (a body would duplicate the file).
   */
  private sanitizeSnippetFix(code: string, cleaned: string): string | null {
    // A single-line class/module header is only fixed by adding a comment above
    // it, but small local models routinely respond with the whole class or file
    // (indented body + closing `end`). The replacement range covers just the
    // header line, so a body would duplicate the file — keep only the
    // comment/header portion, which is always a safe replacement.
    const isHeaderOnly = !code.includes('\n') && /^(?:class|module)\s+[A-Z]/.test(code.trim())
    if (isHeaderOnly) {
      const kept: string[] = []
      for (const line of cleaned.split('\n')) {
        if (/^[ \t]/.test(line) || /^\s*end\b/.test(line)) {break}
        kept.push(line)
      }
      const truncated = kept.join('\n').trimEnd()
      if (truncated === '') {return null}
      // A header fix can be just the missing comment (e.g. "# frozen_string_literal:
      // true" or a doc comment), with the class declaration omitted — keep the
      // header by appending the original snippet.
      return /^\s*(?:class|module)\s+[A-Z]/m.test(truncated)
        ? truncated
        : /^#/.test(truncated)
          ? `${truncated}\n${code}`
          : null
    }

    // Safety guard: reject hallucinated full-file rewrites. A response must not
    // add top-level class/module declarations the snippet lacked.
    const topLevelDecls = (src: string): number => (src.match(/^\s*(?:class|module)\s+[A-Z]/gm) ?? []).length
    if (topLevelDecls(cleaned) > topLevelDecls(code) || (/^#\s*frozen_string_literal/m.test(cleaned) && !/^#\s*frozen_string_literal/m.test(code))) {
      return null
    }

    return cleaned
  }

  /**
   * Real provider status. Cloud providers are probed with their side-effect-free, token-free
   * `GET /models` endpoint, which distinguishes "key present" from "key accepted" and
   * "endpoint reachable"; Ollama is pinged directly.
   */
  async getProviderStatus(): Promise<ProviderStatus> {
    const provider = this.config.provider ?? 'ollama'

    if (provider === 'ollama') {
      try {
        const client = new OllamaClient({ baseUrl: this.config.ollamaHost })
        const checks = await client.healthCheck()
        return checks.some(c => c.reachable)
          ? { state: 'reachable' }
          : { state: 'offline', detail: 'Ollama server not reachable' }
      } catch (err) {
        return { state: 'offline', detail: err instanceof Error ? err.message : String(err) }
      }
    }

    if (provider === 'vscode-lm') {
      return this.config.vscodeLmStatus ? this.config.vscodeLmStatus() : { state: 'error', detail: 'VS Code Language Model API unavailable' }
    }

    const apiKey = await this.config.getApiKey?.()
    if (!apiKey) {return { state: 'unconfigured', detail: 'No API key configured' }}

    const label = provider === 'anthropic' ? 'Anthropic' : 'OpenAI'
    let url: string
    let headers: Record<string, string>
    let model: string
    if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/models?limit=1000'
      headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      model = this.config.anthropicModel ?? 'claude-sonnet-4-5'
    } else {
      const baseUrl = (this.config.openaiBaseUrl ?? 'https://api.openai.com').replace(/\/$/, '')
      if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(baseUrl)) {
        return { state: 'error', detail: `Invalid openaiBaseUrl "${baseUrl}" (HTTPS required)` }
      }
      url = `${baseUrl}/v1/models`
      headers = { Authorization: `Bearer ${apiKey}` }
      model = this.config.openaiModel ?? 'gpt-4o-mini'
    }

    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) })
      if (res.status === 401 || res.status === 403) {
        return { state: 'error', detail: `${label} rejected the API key (${res.status})` }
      }
      if (!res.ok) {
        return { state: 'error', detail: `${label} returned ${res.status} ${res.statusText}` }
      }
      const json = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> }
      const ids = json.data?.map(m => m.id).filter((id): id is string => typeof id === 'string') ?? []
      // Only assert the model is missing when the endpoint returned a model list at all
      // (OpenAI-compatible proxies often don't).
      if (ids.length > 0 && !ids.includes(model)) {
        return { state: 'error', detail: `${label} is reachable but model "${model}" was not found` }
      }
      return { state: 'authenticated' }
    } catch (err) {
      return { state: 'offline', detail: `${label} unreachable: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  /** Back-compat boolean: true only when the provider is actually reachable (and authenticated for cloud). */
  async healthCheck(): Promise<boolean> {
    const { state } = await this.getProviderStatus()
    return state === 'reachable' || state === 'authenticated'
  }

  /** Version grounding: only assert versions the project actually declares. */
  private versionConstraintLines(rubyVer: string, railsVer: string | undefined): string[] {
    const rubyKnown = isKnownVersion(rubyVer)
    const railsKnown = isKnownVersion(railsVer)
    if (rubyKnown && railsKnown) {
      return [
        `CRITICAL CONSTRAINT: The active project strictly uses Ruby ${rubyVer} and Rails ${railsVer}.`,
        `Do NOT use or suggest features from newer Ruby or Rails versions. Only use standard library modules and gem APIs compatible with Ruby ${rubyVer} and Rails ${railsVer}.`,
      ]
    }
    const lines = [
      `CRITICAL CONSTRAINT: Project versions: Ruby ${rubyKnown ? rubyVer : 'UNKNOWN (not declared)'}, Rails ${railsKnown ? railsVer : 'UNKNOWN (not declared)'}.`,
      'Do NOT assume a specific version for any UNKNOWN component and do not claim version-specific compatibility; prefer APIs that are stable across supported releases and flag anything version-dependent.',
    ]
    if (rubyKnown || railsKnown) {
      lines.push(`Do NOT use or suggest features newer than the declared ${rubyKnown ? `Ruby ${rubyVer}` : `Rails ${railsVer}`}.`)
    }
    return lines
  }

  private buildSystemPrompt(context: RailsAgentContext): string {
    const tables = this.schemaIndexer.getAllTables().map(t => `${t.name} (${Array.from(t.columns.keys()).join(', ')})`)
    const routes = this.routesIndexer.getAllRoutes().slice(0, 30).map(r => `${r.verb} ${r.uriPattern} => ${r.controller}#${r.action}`)
    const rubyVer = this.env?.rubyVersion ?? UNKNOWN_VERSION
    const isRailsProject = this.env === undefined || this.env.hasRails

    const parts: string[] = isRailsProject
      ? [
        'You are RailsForge AI, a senior Ruby on Rails engineering assistant.',
        ...this.versionConstraintLines(rubyVer, this.env?.railsVersion),
        'Always produce clean, modern, idiomatic code adhering to RuboCop-Rails standards.',
        'Follow SOLID principles, avoid fat controllers, extract business logic to Service Objects, and prevent N+1 queries.',
        'Before generating a new Service, Query, Form, Policy, or Decorator, search the "Existing Project Patterns" list below. If a close match exists, reuse or extend it instead of writing a new one from scratch, and say so explicitly.',
      ]
      : [
        'You are RailsForge AI, a senior Ruby engineering assistant.',
        `CRITICAL CONSTRAINT: The active project is a standalone Ruby codebase (gem or script) using Ruby ${isKnownVersion(rubyVer) ? rubyVer : '(version not declared — do not assume one)'}. It does NOT depend on Rails — do not assume ActiveRecord, ActionController, or any other Rails framework API is available unless it appears as an actual dependency below.`,
        'Only use Ruby standard library and gem APIs that are actually declared as dependencies.',
        'Follow SOLID principles and keep classes focused on a single responsibility.',
        'Before generating new code, search the "Existing Project Patterns" list below. If a close match exists, reuse or extend it instead of writing a new one from scratch, and say so explicitly.',
      ]

    const patternSummary = this.summarizePatterns()
    if (this.config.legalMode) {
      parts.push(this.legalSkillsPrompt())
    }

    if (patternSummary) {
      parts.push(`Existing Project Patterns (reuse before generating new code):\n${patternSummary}`)
    }

    if (tables.length > 0) {
      parts.push(`Active Database Schema:\n${tables.join('\n')}`)
    }

    if (routes.length > 0) {
      parts.push(`Active Routes Summary (first 30):\n${routes.join('\n')}`)
    }

    if (context.fileName) {
      parts.push(`Current File: ${context.fileName}`)
    }

    if (context.fileContent) {
      parts.push(`File Content:\n\`\`\`ruby\n${context.fileContent}\n\`\`\``)
    }

    return parts.join('\n\n')
  }

  private legalSkillsPrompt(): string {
    return [
      'Legal-domain skills enabled (lawvable):',
      '- Treat legal outputs as drafting, issue-spotting, summarization, and workflow assistance; do not present them as legal advice or a substitute for a licensed attorney.',
      '- Ask for jurisdiction and governing law when material; if absent, state assumptions clearly and avoid jurisdiction-specific claims.',
      '- Preserve confidentiality: minimize sensitive facts in prompts, avoid unnecessary personal data, and flag privileged/confidential material handling risks.',
      '- For contracts and policies, produce structured outputs with parties, definitions, obligations, deadlines, remedies, risks, open questions, and negotiation notes.',
      '- For litigation or regulatory analysis, distinguish facts, assumptions, legal standards, application, evidence gaps, and next actions.',
      '- Cite source text from provided documents by section/heading when available; never invent statutes, cases, deadlines, or filing requirements.',
      '- Highlight uncertainty, missing documents, stale law risks, and recommended attorney review before execution or filing.',
    ].join('\n')
  }

  private buildFixSystemPrompt(diagnosticMessage: string, context: RailsAgentContext): string {
    const rubyVer = this.env?.rubyVersion ?? UNKNOWN_VERSION
    const isRailsProject = this.env === undefined || this.env.hasRails

    const parts: string[] = isRailsProject
      ? [
        'You are RailsForge AI, a senior Ruby on Rails engineering assistant.',
        ...this.versionConstraintLines(rubyVer, this.env?.railsVersion),
        'Follow SOLID principles, avoid fat controllers, extract business logic to Service Objects, and prevent N+1 queries.',
        'Output ONLY a minimal unified diff. No explanation, no markdown fences.',
      ]
      : [
        'You are RailsForge AI, a senior Ruby engineering assistant.',
        `CRITICAL CONSTRAINT: The active project is a standalone Ruby codebase using Ruby ${isKnownVersion(rubyVer) ? rubyVer : '(version not declared — do not assume one)'}. No Rails APIs unless explicitly available.`,
        'Follow SOLID principles. Output ONLY a minimal unified diff. No explanation, no markdown fences.',
      ]

    if (this.config.legalMode) {
      parts.push(this.legalSkillsPrompt())
    }

    // Only include schema tables relevant to the diagnostic (heuristic: class name in message)
    const modelNames = this.extractModelNamesFromDiagnostic(diagnosticMessage, context)
    if (modelNames.length > 0) {
      const relevantTables = this.schemaIndexer.getAllTables()
        .filter(t => modelNames.some(m => m.toLowerCase() === t.name.toLowerCase()))
        .map(t => `${t.name} (${Array.from(t.columns.keys()).join(', ')})`)
      if (relevantTables.length > 0) {
        parts.push(`Relevant Schema:\n${relevantTables.join('\n')}`)
      }
    }

    // Only include patterns matching the diagnostic cop/type
    const relevantPatterns = this.extractRelevantPatterns(diagnosticMessage)
    if (relevantPatterns.length > 0) {
      parts.push(`Relevant Patterns:\n${relevantPatterns.join('\n')}`)
    }

    if (context.fileName) {
      parts.push(`Current File: ${context.fileName}`)
    }

    // Only include the relevant code region (already passed as `context.fileContent`)
    if (context.fileContent) {
      parts.push(`File Content:\n\`\`\`ruby\n${context.fileContent}\n\`\`\``)
    }

    return parts.join('\n\n')
  }

  private extractModelNamesFromDiagnostic(message: string, context: RailsAgentContext): string[] {
    const names: string[] = []
    // Class/module names in backticks
    const backtickMatches = message.match(/`([A-Z][A-Za-z0-9]+)`/g)
    if (backtickMatches) {
      names.push(...backtickMatches.map(m => m.slice(1, -1)))
    }
    // Class names in "class X" patterns
    const classMatches = message.match(/(?:class|module)\s+([A-Z][A-Za-z0-9]+)/g)
    if (classMatches) {
      names.push(...classMatches.map(m => m.split(/\s+/)[1]))
    }
    // Fallback: extract from current file name
    if (context.fileName) {
      const fileBase = context.fileName.split('/').pop()?.replace(/\.rb$/, '')
      if (fileBase) {names.push(fileBase.replace(/_/g, '').replace(/^[a-z]/, c => c.toUpperCase()))}
    }
    return [...new Set(names)]
  }

  private extractRelevantPatterns(message: string): string[] {
    if (!this.patternIndexer) {return []}
    const patterns = this.patternIndexer.getAllPatterns()
    const copMatch = message.match(/\(([A-Z][A-Za-z0-9/]+)\)/)
    const cop = copMatch ? copMatch[1] : null
    if (!cop) {return patterns.slice(0, 3).map(p => `${p.type}: ${p.name} (${p.filePath})`)}
    // Filter patterns by cop prefix (e.g., Style/, Rails/, Layout/)
    const copPrefix = cop.split('/')[0]
    return patterns
      .filter(p => p.type.toLowerCase().includes(copPrefix.toLowerCase()) || p.name.toLowerCase().includes(cop.toLowerCase()))
      .slice(0, 3)
      .map(p => `${p.type}: ${p.name} (${p.filePath})`)
  }

  private summarizePatterns(): string {
    if (!this.patternIndexer) {return ''}

    const byType = new Map<string, string[]>()
    for (const pattern of this.patternIndexer.getAllPatterns()) {
      const list = byType.get(pattern.type) ?? []
      list.push(`${pattern.name} (${pattern.filePath})`)
      byType.set(pattern.type, list)
    }

    return Array.from(byType.entries())
      .map(([type, names]) => `- ${type}: ${names.slice(0, 8).join(', ')}`)
      .join('\n')
  }
}
