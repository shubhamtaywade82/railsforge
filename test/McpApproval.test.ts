import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { invokeTool, InvocableTool, ApprovalPort, ApprovalRequest, ToolCallError } from '../src/mcp/policy/ToolInvocation'
import { AUDIT_RELATIVE_PATH } from '../src/mcp/audit/McpAuditRecorder'
import { RiskLevel } from '../src/mcp/policy/McpCapabilityPolicy'

interface Ctx { workspaceRoot: string }

function tool(risk: RiskLevel, handler = vi.fn(async () => 'ran'), validate?: InvocableTool<Ctx>['validate']): InvocableTool<Ctx> {
  return { name: 'write_file', risk, description: 'Writes a file in the project.', handler, validate }
}

function port(answer: 'granted' | 'denied' | Error | 'hang'): ApprovalPort & { request: ReturnType<typeof vi.fn> } {
  return {
    request: vi.fn(async (_request: ApprovalRequest) => {
      if (answer === 'hang') {return new Promise<'granted'>(() => undefined)}
      if (answer instanceof Error) {throw answer}
      return answer
    }),
  } as never
}

function auditLines(root: string): Array<Record<string, unknown>> {
  const file = path.join(root, AUDIT_RELATIVE_PATH)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
}

describe('R3 calls need approval for each invocation', () => {
  let root: string
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-approval-')) })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  it('does not run an R3 call when no approval port exists, which is how native tools always behave', async () => {
    const handler = vi.fn(async () => 'ran')
    const result = await invokeTool(tool('R3', handler), { workspaceRoot: root }, { path: 'a' }, { source: 'host', isTrusted: () => true })
    expect(result).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' })
    expect(handler).not.toHaveBeenCalled()
    expect(auditLines(root).at(-1)).toMatchObject({ phase: 'denied', approval: 'unavailable', errorCode: 'APPROVAL_REQUIRED' })
  })

  it('runs an R3 call once the user grants this invocation, and records the grant', async () => {
    const handler = vi.fn(async () => 'written')
    const answer = port('granted')
    const result = await invokeTool(tool('R3', handler), { workspaceRoot: root }, { path: 'a' }, { source: 'host', isTrusted: () => true, approval: answer })
    expect(result).toEqual({ ok: true, text: 'written' })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(auditLines(root).map(l => [l.phase, l.approval])).toEqual([['started', 'granted'], ['finished', 'granted']])
  })

  it('asks again for every call: one approval is never a standing grant', async () => {
    const answer = port('granted')
    const t = tool('R3')
    await invokeTool(t, { workspaceRoot: root }, { path: 'a' }, { source: 'host', isTrusted: () => true, approval: answer })
    await invokeTool(t, { workspaceRoot: root }, { path: 'b' }, { source: 'host', isTrusted: () => true, approval: answer })
    expect(answer.request).toHaveBeenCalledTimes(2)
  })

  it('does not run an R3 call the user refused, and says so', async () => {
    const handler = vi.fn(async () => 'ran')
    const result = await invokeTool(tool('R3', handler), { workspaceRoot: root }, { path: 'a' }, { source: 'host', isTrusted: () => true, approval: port('denied') })
    expect(result).toMatchObject({ ok: false, code: 'APPROVAL_DENIED' })
    expect(handler).not.toHaveBeenCalled()
    expect(auditLines(root).at(-1)).toMatchObject({ phase: 'denied', approval: 'denied', errorCode: 'APPROVAL_DENIED' })
  })

  it('treats a prompt that fails as not approved, and a prompt that never answers as not approved after its timeout', async () => {
    const handler = vi.fn(async () => 'ran')
    const failing = await invokeTool(tool('R3', handler), { workspaceRoot: root }, { path: 'a' }, { source: 'host', isTrusted: () => true, approval: port(new Error('no window')) })
    expect(failing).toMatchObject({ ok: false, code: 'APPROVAL_UNAVAILABLE' })
    const silent = await invokeTool(tool('R3', handler), { workspaceRoot: root }, { path: 'a' }, { source: 'host', isTrusted: () => true, approval: port('hang'), approvalTimeoutMs: 20 })
    expect(silent).toMatchObject({ ok: false, code: 'APPROVAL_UNAVAILABLE' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('shows the user the tool, the workspace, the operation and the arguments, but audits only the argument names', async () => {
    const answer = port('denied')
    await invokeTool(tool('R3'), { workspaceRoot: root }, { path: 'app/models/order.rb', body: 'SECRET_BODY_TEXT' }, { source: 'host', isTrusted: () => true, approval: answer })
    const request = answer.request.mock.calls[0][0] as ApprovalRequest
    expect(request).toMatchObject({ tool: 'write_file', risk: 'R3', workspaceRoot: root, operation: 'Writes a file in the project.', argumentNames: ['body', 'path'] })
    expect(request.argumentPreview).toContain('SECRET_BODY_TEXT')
    const audit = fs.readFileSync(path.join(root, AUDIT_RELATIVE_PATH), 'utf8')
    expect(audit).not.toContain('SECRET_BODY_TEXT')
    expect(audit).not.toContain('order.rb')
  })

  it('refuses and does not run a call that is cancelled while its prompt is open', async () => {
    const controller = new AbortController()
    const handler = vi.fn(async () => 'ran')
    const hanging: ApprovalPort = { request: () => { controller.abort(); return new Promise<'granted'>(() => undefined) } }
    const result = await invokeTool(tool('R3', handler), { workspaceRoot: root }, { path: 'a' }, { source: 'host', isTrusted: () => true, approval: hanging, signal: controller.signal, approvalTimeoutMs: 1000 })
    expect(result).toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(handler).not.toHaveBeenCalled()
  })
})

/** A port whose answers the test gives, one call at a time, and which records the signal each prompt was given. */
function gatedPort() {
  const prompts: AbortSignal[] = []
  const pending: Array<(answer: 'granted' | 'denied') => void> = []
  const port = {
    request: vi.fn((_request: ApprovalRequest, signal?: AbortSignal) => {
      if (signal) {prompts.push(signal)}
      return new Promise<'granted' | 'denied'>(resolve => { pending.push(resolve) })
    }),
  }
  /** Answers the most recent prompt that is still open. */
  const answer = (value: 'granted' | 'denied'): void => { pending.pop()?.(value) }
  return { port: port as ApprovalPort & { request: typeof port.request }, prompts, answer }
}

describe('the approval lifecycle: a stop, a timeout and a late answer', () => {
  let root: string
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-approval-life-')) })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  const invoke = (handler: () => Promise<string>, options: Parameters<typeof invokeTool>[3]) =>
    invokeTool(tool('R3', handler), { workspaceRoot: root }, { path: 'a' }, options)

  it('a stop while the prompt is open ends the invocation at once, and tells the prompt to close', async () => {
    const gate = gatedPort()
    const controller = new AbortController()
    const handler = vi.fn(async () => 'ran')
    const started = Date.now()
    const pending = invoke(handler, { source: 'host', isTrusted: () => true, approval: gate.port, signal: controller.signal, approvalTimeoutMs: 60_000 })
    await vi.waitFor(() => expect(gate.prompts).toHaveLength(1))

    controller.abort()
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(Date.now() - started).toBeLessThan(5_000) // it did not wait for the prompt, which never answered
    expect(gate.prompts[0].aborted).toBe(true)
    expect(handler).not.toHaveBeenCalled()
  })

  it('an "Allow once" that arrives after the stop is never run, and leaves no started record', async () => {
    const gate = gatedPort()
    const controller = new AbortController()
    const handler = vi.fn(async () => 'ran')
    const pending = invoke(handler, { source: 'host', isTrusted: () => true, approval: gate.port, signal: controller.signal, approvalTimeoutMs: 60_000 })
    await vi.waitFor(() => expect(gate.prompts).toHaveLength(1))
    controller.abort()
    await expect(pending).resolves.toMatchObject({ code: 'CANCELLED' })

    gate.answer('granted') // the user clicks after the stop
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(handler).not.toHaveBeenCalled()
    expect(auditLines(root).some(line => line.phase === 'started')).toBe(false)
  })

  it('a timeout ends the wait, tells the prompt to close, and a late answer is ignored', async () => {
    const gate = gatedPort()
    const handler = vi.fn(async () => 'ran')
    const result = await invoke(handler, { source: 'host', isTrusted: () => true, approval: gate.port, approvalTimeoutMs: 20 })
    expect(result).toMatchObject({ ok: false, code: 'APPROVAL_UNAVAILABLE' })
    expect(gate.prompts[0].aborted).toBe(true)

    gate.answer('granted')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(handler).not.toHaveBeenCalled()
  })

  it('a stop pressed more than once changes nothing after the first', async () => {
    const gate = gatedPort()
    const controller = new AbortController()
    const handler = vi.fn(async () => 'ran')
    const pending = invoke(handler, { source: 'host', isTrusted: () => true, approval: gate.port, signal: controller.signal, approvalTimeoutMs: 60_000 })
    await vi.waitFor(() => expect(gate.prompts).toHaveLength(1))

    controller.abort()
    controller.abort()
    await expect(pending).resolves.toMatchObject({ code: 'CANCELLED' })
    expect(gate.port.request).toHaveBeenCalledTimes(1)
    expect(handler).not.toHaveBeenCalled()
  })

  it('a later, independent call obtains its own approval after an earlier call was stopped', async () => {
    const gate = gatedPort()
    const first = new AbortController()
    const handler = vi.fn(async () => 'ran')
    const stopped = invoke(handler, { source: 'host', isTrusted: () => true, approval: gate.port, signal: first.signal, approvalTimeoutMs: 60_000 })
    await vi.waitFor(() => expect(gate.prompts).toHaveLength(1))
    first.abort()
    await expect(stopped).resolves.toMatchObject({ code: 'CANCELLED' })

    const next = invoke(handler, { source: 'host', isTrusted: () => true, approval: gate.port, approvalTimeoutMs: 60_000 })
    await vi.waitFor(() => expect(gate.prompts).toHaveLength(2))
    gate.answer('granted')
    await expect(next).resolves.toEqual({ ok: true, text: 'ran' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('a call whose operation was already stopped gets no prompt at all', async () => {
    const gate = gatedPort()
    const controller = new AbortController()
    controller.abort()
    const handler = vi.fn(async () => 'ran')
    const result = await invoke(handler, { source: 'host', isTrusted: () => true, approval: gate.port, signal: controller.signal })
    expect(result).toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(gate.port.request).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('malformed, forbidden and untrusted calls never reach the handler or the prompt', () => {
  let root: string
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-approval-')) })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  it('refuses malformed arguments before approval is asked for, and before the handler', async () => {
    const answer = port('granted')
    const handler = vi.fn(async () => 'ran')
    const result = await invokeTool(tool('R3', handler, () => 'path: is required'), { workspaceRoot: root }, {}, { source: 'host', isTrusted: () => true, approval: answer })
    expect(result).toEqual({ ok: false, code: 'INVALID_ARGUMENTS', message: 'RailsForge: write_file was not run. path: is required' })
    expect(answer.request).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
    expect(auditLines(root).at(-1)).toMatchObject({ phase: 'denied', errorCode: 'INVALID_ARGUMENTS' })
  })

  it('never asks about an R4 call, and refuses it whatever the user would say', async () => {
    const answer = port('granted')
    const handler = vi.fn(async () => 'ran')
    const result = await invokeTool(tool('R4', handler), { workspaceRoot: root }, {}, { source: 'host', isTrusted: () => true, approval: answer })
    expect(result).toMatchObject({ ok: false, code: 'DISABLED_BY_POLICY' })
    expect(answer.request).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('refuses an R2 call in an untrusted workspace without asking, and never starts it', async () => {
    const answer = port('granted')
    const handler = vi.fn(async () => 'ran')
    const result = await invokeTool(tool('R2', handler), { workspaceRoot: root }, {}, { source: 'host', isTrusted: () => false, approval: answer })
    expect(result).toMatchObject({ ok: false, code: 'WORKSPACE_UNTRUSTED' })
    expect(answer.request).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes the cancellation signal to the handler, and refuses a call that is already cancelled', async () => {
    const controller = new AbortController()
    const seen = vi.fn(async (_ctx: Ctx, _input: Record<string, unknown>, signal?: AbortSignal) => { expect(signal).toBe(controller.signal); return 'ran' })
    const live = await invokeTool(tool('R2', seen), { workspaceRoot: root }, {}, { source: 'host', isTrusted: () => true, signal: controller.signal })
    expect(live).toEqual({ ok: true, text: 'ran' })
    controller.abort()
    const cancelled = await invokeTool(tool('R2', seen), { workspaceRoot: root }, {}, { source: 'host', isTrusted: () => true, signal: controller.signal })
    expect(cancelled).toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('reports a code the handler chose, such as TIMEOUT, rather than a generic failure', async () => {
    const throwing = tool('R2', vi.fn(async () => { throw new ToolCallError('TIMEOUT', 'the server did not answer in time') }))
    const result = await invokeTool(throwing, { workspaceRoot: root }, {}, { source: 'host', isTrusted: () => true })
    expect(result).toEqual({ ok: false, code: 'TIMEOUT', message: 'the server did not answer in time' })
  })
})

describe('native compatibility', () => {
  it('keeps the standalone source refusing an R3 call with the same code and message as before', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-native-'))
    try {
      const result = await invokeTool(tool('R3'), { workspaceRoot: root }, {}, { source: 'standalone', isTrusted: () => true })
      expect(result).toEqual({ ok: false, code: 'APPROVAL_REQUIRED', message: 'RailsForge: write_file was not run. This tool needs per-call approval, which this build does not provide.' })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
