import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { RAILSFORGE_TOOLS } from '../src/mcp/tools/definitions'
import { ToolContext } from '../src/mcp/tools/ToolContext'
import { redactSecrets } from '../src/mcp/tools/observability'
import { writeRailsFixture } from './support/railsFixture'

describe('Observability MCP tools', () => {
  let root: string
  let ctx: ToolContext
  const tool = (name: string) => RAILSFORGE_TOOLS.find(t => t.name === name)!
  const run = (name: string, input: Record<string, unknown>): Promise<string> => tool(name).handler(ctx, input)

  beforeEach(() => {
    root = writeRailsFixture()
    ctx = new ToolContext(root)
  })

  afterEach(() => {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  describe('redactSecrets', () => {
    it('redacts tokens, passwords, bearer tokens, and auth headers', () => {
      const line1 = 'Parameters: {"user"=>{"password"=>"supersecret", "email"=>"a@b.com"}}'
      expect(redactSecrets(line1)).toBe('Parameters: {"user"=>{"password"=>[FILTERED], "email"=>"a@b.com"}}')

      const line2 = 'Headers: {"Authorization": "Bearer my_jwt_token_123"}'
      expect(redactSecrets(line2)).toContain('Bearer [FILTERED]')

      const line3 = 'API Request: {"api_key": "secret_key_val"}'
      expect(redactSecrets(line3)).toBe('API Request: {"api_key": "[FILTERED]"}')
    })
  })

  describe('ruby_read_log', () => {
    it('reads development log, redacts secrets, and parses request metrics', async () => {
      const logDir = path.join(root, 'log')
      fs.mkdirSync(logDir, { recursive: true })
      const devLog = path.join(logDir, 'development.log')
      const sample = [
        'Started POST "/orders" for 127.0.0.1 at 2026-11-09 10:00:00',
        'Processing by OrdersController#create as JSON',
        '  Parameters: {"token"=>"secret_token_123", "order"=>{"total"=>"42.00"}}',
        '  Order Create (1.2ms)  INSERT INTO "orders" ("total") VALUES (42.0)',
        'Completed 200 OK in 45.2ms (Views: 5.1ms | ActiveRecord: 12.3ms | Allocations: 1200)',
      ].join('\n')
      fs.writeFileSync(devLog, sample)

      const raw = await run('ruby_read_log', { environment: 'development', lines: 10 })
      const res = JSON.parse(raw) as {
        logFile: string
        lineCount: number
        summary: { requests: Array<{ status: number; durationMs: number; dbTimeMs?: number }>; detectedErrors: number }
        lines: string[]
      }

      expect(res.logFile).toBe('log/development.log')
      expect(res.summary.requests).toHaveLength(1)
      expect(res.summary.requests[0].status).toBe(200)
      expect(res.summary.requests[0].durationMs).toBe(45.2)
      expect(res.summary.requests[0].dbTimeMs).toBe(12.3)
      expect(res.summary.detectedErrors).toBe(0)
      const paramLine = res.lines.find(l => l.includes('Parameters:'))!
      expect(paramLine).toContain('"token"=>[FILTERED]')
    })

    it('filters log lines by substring', async () => {
      const logDir = path.join(root, 'log')
      fs.mkdirSync(logDir, { recursive: true })
      fs.writeFileSync(
        path.join(logDir, 'test.log'),
        'Line A: normal\nLine B: Error (ActiveRecord::RecordNotFound): Record not found\nLine C: clean\n',
      )

      const raw = await run('ruby_read_log', { environment: 'test', filter: 'Error' })
      const res = JSON.parse(raw) as { lines: string[]; summary: { detectedErrors: number } }

      expect(res.lines).toHaveLength(1)
      expect(res.lines[0]).toContain('RecordNotFound')
      expect(res.summary.detectedErrors).toBe(1)
    })

    it('returns error when log file does not exist', async () => {
      const raw = await run('ruby_read_log', { environment: 'development' })
      const res = JSON.parse(raw) as { error?: string }
      expect(res.error).toContain('Log file not found')
    })
  })
})
