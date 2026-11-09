import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_RELATIVE_PATH } from '../src/mcp/audit/McpAuditRecorder'
import type { RiskLevel } from '../src/mcp/policy/McpCapabilityPolicy'
import { invokeTool } from '../src/mcp/policy/ToolInvocation'
import { UntrustedWorkspaceError } from '../src/workspace/Trust'

interface Ctx {
  workspaceRoot: string
}

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-invoke-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function auditRecords(): Array<Record<string, unknown>> {
  const file = path.join(root, AUDIT_RELATIVE_PATH)
  if (!fs.existsSync(file)) {return []}
  return fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
}

function namedTool(name: string, risk: RiskLevel, handler: (ctx: Ctx, input: Record<string, unknown>) => Promise<string>) {
  return { name, risk, handler }
}

describe('invokeTool: policy comes before the handler', () => {
  it('refuses project code in standalone mode without a grant, and never runs the handler', async () => {
    const handler = vi.fn(async () => 'ran')
    const result = await invokeTool(namedTool('list_rake_tasks', 'R2', handler), { workspaceRoot: root }, { filter: 'db' }, {
      source: 'standalone',
      isTrusted: () => false,
    })

    expect(result).toMatchObject({ ok: false, code: 'EXECUTION_DISABLED' })
    expect(handler).not.toHaveBeenCalled()
    expect(auditRecords()).toEqual([
      expect.objectContaining({ phase: 'denied', outcome: 'denied', errorCode: 'EXECUTION_DISABLED', tool: 'list_rake_tasks', risk: 'R2', source: 'standalone', trusted: false }),
    ])
  })

  it('runs a trusted project-code call and writes a started and a finished record with the duration', async () => {
    const handler = vi.fn(async () => 'ran')
    const instants = [new Date('2026-11-09T10:00:00.000Z'), new Date('2026-11-09T10:00:00.250Z')]
    const result = await invokeTool(namedTool('run_tests', 'R2', handler), { workspaceRoot: root }, {}, {
      source: 'standalone',
      isTrusted: () => true,
      now: () => instants.shift() ?? new Date(),
      newRequestId: () => 'req-1',
    })

    expect(result).toEqual({ ok: true, text: 'ran' })
    const records = auditRecords()
    expect(records.map(r => r.phase)).toEqual(['started', 'finished'])
    expect(records[1]).toMatchObject({ requestId: 'req-1', outcome: 'success', durationMs: 250 })
  })

  it('refuses a project-code call whose audit record cannot be written, before the handler runs', async () => {
    const handler = vi.fn(async () => 'ran')
    const result = await invokeTool(namedTool('run_tests', 'R2', handler), { workspaceRoot: path.join(root, 'absent') }, {}, {
      source: 'standalone',
      isTrusted: () => true,
    })

    expect(result).toMatchObject({ ok: false, code: 'AUDIT_UNAVAILABLE' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('still runs a static read when its audit record cannot be written, and reports a real write problem', async () => {
    fs.writeFileSync(path.join(root, '.railsforge'), 'a file where the audit directory should be')
    const warn = vi.fn()
    const handler = vi.fn(async () => 'static')
    const result = await invokeTool(namedTool('get_schema', 'R0', handler), { workspaceRoot: root }, {}, {
      source: 'standalone',
      isTrusted: () => false,
      warn,
    })

    expect(result).toEqual({ ok: true, text: 'static' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('audit record not written'))
  })

  it('does not warn about a missing workspace root, which has no audit trail to keep', async () => {
    const warn = vi.fn()
    await invokeTool(namedTool('get_schema', 'R0', async () => 'static'), { workspaceRoot: path.join(root, 'absent') }, {}, {
      source: 'host',
      isTrusted: () => false,
      warn,
    })

    expect(warn).not.toHaveBeenCalled()
  })
})

describe('invokeTool: outcomes and what is recorded', () => {
  it('reports a refusal from the process layer as a denial, not as a failure', async () => {
    const handler = vi.fn(async () => {
      throw new UntrustedWorkspaceError('rake')
    })
    const result = await invokeTool(namedTool('list_rake_tasks', 'R2', handler), { workspaceRoot: root }, {}, {
      source: 'host',
      isTrusted: () => true,
    })

    expect(result).toMatchObject({ ok: false, code: 'WORKSPACE_UNTRUSTED' })
    expect(auditRecords().at(-1)).toMatchObject({ phase: 'denied', errorCode: 'WORKSPACE_UNTRUSTED' })
  })

  it('reports an ordinary handler error as a failure that keeps its message', async () => {
    const result = await invokeTool(namedTool('get_schema', 'R0', async () => {
      throw new Error('boom')
    }), { workspaceRoot: root }, {}, { source: 'standalone', isTrusted: () => false })

    expect(result).toEqual({ ok: false, code: 'TOOL_FAILED', message: 'boom' })
    expect(auditRecords().at(-1)).toMatchObject({ phase: 'finished', outcome: 'failure', errorCode: 'TOOL_FAILED' })
  })

  it('records the names of the input fields and never their values', async () => {
    await invokeTool(namedTool('get_skill', 'R0', async () => 'skill text'), { workspaceRoot: root }, { token: 'hunter2-secret', id: 'rails-debugging' }, {
      source: 'standalone',
      isTrusted: () => false,
    })

    const raw = fs.readFileSync(path.join(root, AUDIT_RELATIVE_PATH), 'utf8')
    expect(raw).not.toContain('hunter2-secret')
    expect(raw).not.toContain('rails-debugging')
    expect(auditRecords()[0].argumentNames).toEqual(['id', 'token'])
  })

  it('treats a trust provider that throws as untrusted', async () => {
    const handler = vi.fn(async () => 'ran')
    const result = await invokeTool(namedTool('run_tests', 'R2', handler), { workspaceRoot: root }, {}, {
      source: 'standalone',
      isTrusted: () => {
        throw new Error('host exploded')
      },
    })

    expect(result).toMatchObject({ ok: false, code: 'EXECUTION_DISABLED' })
    expect(handler).not.toHaveBeenCalled()
  })
})
