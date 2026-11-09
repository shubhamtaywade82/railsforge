import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AUDIT_RELATIVE_PATH, AUDIT_ROTATE_BYTES, AuditRootMissingError, McpAuditRecorder, type McpAuditEvent } from '../src/mcp/audit/McpAuditRecorder'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-audit-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const event = (requestId: string): McpAuditEvent => ({
  requestId,
  phase: 'finished',
  tool: 'get_schema',
  risk: 'R0',
  source: 'standalone',
  trusted: false,
  argumentNames: [],
  startedAt: '2026-11-09T10:00:00.000Z',
  outcome: 'success',
})

describe('McpAuditRecorder', () => {
  it('appends one JSON line per event, in order', () => {
    const recorder = new McpAuditRecorder(root)
    recorder.record(event('a'))
    recorder.record(event('b'))

    const lines = fs.readFileSync(path.join(root, AUDIT_RELATIVE_PATH), 'utf8').trim().split('\n')
    expect(lines.map(line => JSON.parse(line).requestId)).toEqual(['a', 'b'])
  })

  it('refuses, and creates nothing, when the workspace root is missing', () => {
    const recorder = new McpAuditRecorder(path.join(root, 'absent'))
    expect(() => recorder.record(event('a'))).toThrow(AuditRootMissingError)
    expect(fs.existsSync(path.join(root, 'absent'))).toBe(false)
  })

  it('rotates a full file to one previous generation, so the trail stays bounded', () => {
    const file = path.join(root, AUDIT_RELATIVE_PATH)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'x'.repeat(AUDIT_ROTATE_BYTES))

    new McpAuditRecorder(root).record(event('after-rotation'))

    expect(fs.statSync(`${file}.1`).size).toBe(AUDIT_ROTATE_BYTES)
    const current = fs.readFileSync(file, 'utf8').trim().split('\n')
    expect(current).toHaveLength(1)
    expect(JSON.parse(current[0]).requestId).toBe('after-rotation')
  })
})
