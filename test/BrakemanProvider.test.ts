import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }))

vi.mock('child_process', () => ({ execFile: mockExecFile }))
vi.mock('util', () => ({ promisify: () => mockExecFile }))

import { BrakemanProvider } from '../src/lint/BrakemanProvider'

describe('BrakemanProvider', () => {
  let provider: BrakemanProvider
  let workspace: string

  beforeEach(() => {
    vi.clearAllMocks()
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-brakeman-'))
    fs.writeFileSync(path.join(workspace, 'Gemfile'), 'source "https://rubygems.org"\n')
    provider = new BrakemanProvider()
  })

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  describe('runScan', () => {
    it('returns parsed report when bundle exec brakeman succeeds', async () => {
      const report = { warnings: [{ warning_type: 'SQLInjection', warning_code: 0, fingerprint: 'abc', message: 'SQL injection', file: 'app.rb', line: 10, link: 'https://example.com', confidence: 'High' }], errors: [], scan_info: { duration: 1.5 } }
      mockExecFile.mockResolvedValue({ stdout: JSON.stringify(report) })

      const result = await provider.runScan(workspace)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0].warning_type).toBe('SQLInjection')
      expect(result.scanDuration).toBe(1.5)
      expect(result.errors).toEqual([])
    })

    it('falls back to bare brakeman when bundle exec fails with no stdout', async () => {
      const report = { warnings: [], errors: [], scan_info: { duration: 0.5 } }
      mockExecFile.mockImplementation((cmd: string, args?: string[]) => {
        const invocation = [cmd, ...(args ?? [])].join(' ')
        if (invocation.includes('brakeman') && !invocation.includes('bundle exec')) {
          return Promise.resolve({ stdout: JSON.stringify(report) })
        }
        return Promise.reject(new Error('not found'))
      })

      const result = await provider.runScan(workspace)
      expect(result.scanDuration).toBe(0.5)
      expect(mockExecFile.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('parses stdout from bundle exec failure when stdout is present', async () => {
      const report = { warnings: [{ warning_type: 'XSS', warning_code: 1, fingerprint: 'def', message: 'XSS found', file: 'view.erb', line: 5, link: '', confidence: 'Medium' }], errors: ['some error'], scan_info: { duration: 2.0 } }
      const err = Object.assign(new Error('exit code 1'), { stdout: JSON.stringify(report) })
      mockExecFile.mockRejectedValue(err)

      const result = await provider.runScan(workspace)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0].warning_type).toBe('XSS')
      expect(result.errors).toEqual(['some error'])
      expect(mockExecFile).toHaveBeenCalledTimes(1)
    })

    it('returns error report when both bundle exec and bare brakeman fail', async () => {
      mockExecFile
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))

      const result = await provider.runScan(workspace)
      expect(result.warnings).toEqual([])
      expect(result.errors).toEqual(['Brakeman execution failed.'])
      expect(result.scanDuration).toBe(0)
    })

    it('handles invalid JSON gracefully', async () => {
      const err = Object.assign(new Error('bad json'), { stdout: 'not json' })
      mockExecFile.mockRejectedValue(err)

      const result = await provider.runScan(workspace)
      expect(result.warnings).toEqual([])
      expect(result.errors).toEqual(['Brakeman execution failed.'])
    })

    it('handles report with missing fields gracefully', async () => {
      mockExecFile.mockResolvedValue({ stdout: '{}' })

      const result = await provider.runScan(workspace)
      expect(result.warnings).toEqual([])
      expect(result.errors).toEqual([])
      expect(result.scanDuration).toBe(0)
    })
  })

  describe('formatMarkdownReport', () => {
    it('formats a clean report', () => {
      const p = new BrakemanProvider()
      const md = p.formatMarkdownReport({ warnings: [], errors: [], scanDuration: 0 })
      expect(md).toContain('0 Security Vulnerabilities')
    })

    it('formats warnings with confidence and location', () => {
      const p = new BrakemanProvider()
      const md = p.formatMarkdownReport({
        warnings: [{
          warning_type: 'SQL Injection',
          warning_code: 0,
          fingerprint: 'x',
          message: 'Possible SQL injection',
          file: 'app/models/user.rb',
          line: 12,
          link: '',
          confidence: 'High',
        }],
        errors: [],
        scanDuration: 1,
      })
      expect(md).toContain('SQL Injection')
      expect(md).toContain('app/models/user.rb:12')
    })
  })
})
