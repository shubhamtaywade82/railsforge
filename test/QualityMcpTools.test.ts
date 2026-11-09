import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { RAILSFORGE_TOOLS } from '../src/mcp/tools/definitions'
import { ToolContext } from '../src/mcp/tools/ToolContext'
import { setTrustProvider, TrustProvider } from '../src/workspace/Trust'
import { writeRailsFixture } from './support/railsFixture'

describe('Quality MCP tools', () => {
  let root: string
  let ctx: ToolContext
  let restoreTrust: TrustProvider
  const tool = (name: string) => RAILSFORGE_TOOLS.find(t => t.name === name)!
  const run = (name: string, input: Record<string, unknown>): Promise<string> => tool(name).handler(ctx, input)

  beforeEach(() => {
    restoreTrust = setTrustProvider(() => true)
    root = writeRailsFixture()
    ctx = new ToolContext(root)
  })

  afterEach(() => {
    setTrustProvider(restoreTrust)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  describe('ruby_find_affected_tests', () => {
    it('finds existing spec and test files for a model', async () => {
      const specFile = path.join(root, 'spec', 'models', 'order_spec.rb')
      fs.mkdirSync(path.dirname(specFile), { recursive: true })
      fs.writeFileSync(specFile, 'RSpec.describe Order do; end\n')

      const raw = await run('ruby_find_affected_tests', { path: 'app/models/order.rb' })
      const res = JSON.parse(raw) as { filePath: string; testFiles: string[] }

      expect(res.filePath).toBe('app/models/order.rb')
      expect(res.testFiles).toContain('spec/models/order_spec.rb')
    })

    it('finds request specs for a controller', async () => {
      const reqSpec = path.join(root, 'spec', 'requests', 'orders_spec.rb')
      fs.mkdirSync(path.dirname(reqSpec), { recursive: true })
      fs.writeFileSync(reqSpec, 'RSpec.describe "Orders" do; end\n')

      const raw = await run('ruby_find_affected_tests', { path: 'app/controllers/orders_controller.rb' })
      const res = JSON.parse(raw) as { testFiles: string[] }

      expect(res.testFiles).toContain('spec/requests/orders_spec.rb')
    })

    it('rejects path traversal attempts', async () => {
      const raw = await run('ruby_find_affected_tests', { path: '../../etc/passwd' })
      const res = JSON.parse(raw) as { error?: string }
      expect(res.error).toContain('Invalid path')
    })
  })

  describe('ruby_run_tests', () => {
    it('executes rspec via binstub and parses JSON summary and failures', async () => {
      const specFile = path.join(root, 'spec', 'models', 'order_spec.rb')
      fs.mkdirSync(path.dirname(specFile), { recursive: true })
      fs.writeFileSync(specFile, 'RSpec.describe Order do\n  it "fails" do\n    expect(1).to eq(2)\n  end\nend\n')

      const binDir = path.join(root, 'bin')
      fs.mkdirSync(binDir, { recursive: true })
      const rspecStub = path.join(binDir, 'rspec')
      fs.writeFileSync(
        rspecStub,
        '#!/bin/sh\ncat << \'EOF\'\n{\n  "version": "3.13.0",\n  "examples": [\n    {\n      "description": "fails",\n      "full_description": "Order fails",\n      "status": "failed",\n      "file_path": "./spec/models/order_spec.rb",\n      "line_number": 2,\n      "exception": { "message": "expected 2, got 1" }\n    }\n  ],\n  "summary": { "example_count": 1, "failure_count": 1, "pending_count": 0 }\n}\nEOF\nexit 1\n',
      )
      fs.chmodSync(rspecStub, 0o755)

      const raw = await run('ruby_run_tests', { path: 'spec/models/order_spec.rb', line: 2 })
      const res = JSON.parse(raw) as {
        framework: string
        status: string
        summary: { total: number; passed: number; failed: number }
        failures: Array<{ description: string; line: number; message: string }>
      }

      expect(res.framework).toBe('rspec')
      expect(res.status).toBe('failed')
      expect(res.summary.total).toBe(1)
      expect(res.summary.failed).toBe(1)
      expect(res.failures[0].description).toBe('Order fails')
      expect(res.failures[0].line).toBe(2)
    })

    it('refuses execution when workspace is untrusted', async () => {
      setTrustProvider(() => false)
      const specFile = path.join(root, 'spec', 'models', 'order_spec.rb')
      fs.mkdirSync(path.dirname(specFile), { recursive: true })
      fs.writeFileSync(specFile, 'RSpec.describe Order do; end\n')

      const raw = await run('ruby_run_tests', { path: 'spec/models/order_spec.rb' })
      expect(raw).toContain('Restricted Mode')
    })

    it('returns error when test file does not exist', async () => {
      const raw = await run('ruby_run_tests', { path: 'spec/models/missing_spec.rb' })
      const res = JSON.parse(raw) as { error?: string }
      expect(res.error).toContain('File not found')
    })
  })

  describe('ruby_run_linter', () => {
    it('executes rubocop via binstub and parses offenses', async () => {
      const binDir = path.join(root, 'bin')
      fs.mkdirSync(binDir, { recursive: true })
      const rubocopStub = path.join(binDir, 'rubocop')
      fs.writeFileSync(
        rubocopStub,
        '#!/bin/sh\ncat << \'EOF\'\n{\n  "files": [\n    {\n      "path": "app/models/order.rb",\n      "offenses": [\n        {\n          "severity": "convention",\n          "message": "Prefer single-quotes",\n          "cop_name": "Style/StringLiterals",\n          "corrected": false,\n          "correctable": true,\n          "location": { "start_line": 2, "start_column": 3 }\n        }\n      ]\n    }\n  ],\n  "summary": { "offense_count": 1 }\n}\nEOF\nexit 1\n',
      )
      fs.chmodSync(rubocopStub, 0o755)

      const raw = await run('ruby_run_linter', { path: 'app/models/order.rb' })
      const res = JSON.parse(raw) as {
        tool: string
        status: string
        offenseCount: number
        offenses: Array<{ cop: string; message: string; severity: string; correctable: boolean }>
      }

      expect(res.tool).toBe('rubocop')
      expect(res.status).toBe('offenses_found')
      expect(res.offenseCount).toBe(1)
      expect(res.offenses[0].cop).toBe('Style/StringLiterals')
      expect(res.offenses[0].correctable).toBe(true)
    })

    it('reports error when linted file does not exist', async () => {
      const raw = await run('ruby_run_linter', { path: 'app/models/ghost.rb' })
      const res = JSON.parse(raw) as { error?: string }
      expect(res.error).toContain('File not found')
    })
  })

  describe('ruby_analyze_test_failure', () => {
    it('parses RSpec failure with error class, expected/actual, and workspace lines', async () => {
      const output = `
Failures:

  1) Order#process when card declined raises PaymentError
     Failure/Error: order.process
     PaymentGateway::DeclinedError:
       Card was declined: expected PaymentError, got PaymentGateway::DeclinedError
     # ./app/models/order.rb:14:in \`process'
     # ./spec/models/order_spec.rb:25:in \`block (3 levels)'
`
      const raw = await run('ruby_analyze_test_failure', { output })
      const res = JSON.parse(raw) as {
        failureCount: number
        failures: Array<{
          testName: string
          errorClass?: string
          file?: string
          line?: number
          backtrace: string[]
        }>
      }

      expect(res.failureCount).toBe(1)
      expect(res.failures[0].testName).toBe('Order#process when card declined raises PaymentError')
      expect(res.failures[0].errorClass).toBe('PaymentGateway::DeclinedError')
      expect(res.failures[0].file).toBe('app/models/order.rb')
      expect(res.failures[0].line).toBe(14)
      expect(res.failures[0].backtrace.length).toBeGreaterThanOrEqual(2)
    })

    it('returns empty failures when test output has no failures', async () => {
      const output = 'Finished in 0.05 seconds\n5 examples, 0 failures\n'
      const raw = await run('ruby_analyze_test_failure', { output })
      const res = JSON.parse(raw) as { failureCount: number; failures: unknown[] }
      expect(res.failureCount).toBe(0)
      expect(res.failures).toEqual([])
    })
  })
})
