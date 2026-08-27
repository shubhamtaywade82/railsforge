import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrakemanProvider } from '../src/lint/BrakemanProvider'

const mockExecFile = vi.fn()
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}))

describe('BrakemanProvider', () => {
  let provider: BrakemanProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new BrakemanProvider()
  })

  describe('runScan', () => {
    it('returns parsed report when bundle exec brakeman succeeds', async () => {
      const report = { warnings: [{ warning_type: 'SQLInjection', warning_code: 0, fingerprint: 'abc', message: 'SQL injection', file: 'app.rb', line: 10, link: 'https://example.com', confidence: 'High' }], errors: [], scan_info: { duration: 1.5 } }
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: null, result: { stdout: string }) => void) => {
        cb(null, { stdout: JSON.stringify(report) })
      })

      const result = await provider.runScan('/workspace')
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0].warning_type).toBe('SQLInjection')
      expect(result.scanDuration).toBe(1.5)
      expect(result.errors).toEqual([])
    })

    it('falls back to bare brakeman when bundle exec fails with no stdout', async () => {
      const report = { warnings: [], errors: [], scan_info: { duration: 0.5 } }
      // bundle exec fails
      mockExecFile
        .mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
          cb(new Error('not found'))
        })
        .mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, cb: (err: null, result: { stdout: string }) => void) => {
          cb(null, { stdout: JSON.stringify(report) })
        })

      const result = await provider.runScan('/workspace')
      expect(result.scanDuration).toBe(0.5)
      expect(mockExecFile).toHaveBeenCalledTimes(2)
    })

    it('parses stdout from bundle exec failure when stdout is present', async () => {
      const report = { warnings: [{ warning_type: 'XSS', warning_code: 1, fingerprint: 'def', message: 'XSS found', file: 'view.erb', line: 5, link: '', confidence: 'Medium' }], errors: ['some error'], scan_info: { duration: 2.0 } }
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error & { stdout: string }) => void) => {
        const err = new Error('exit code 1') as Error & { stdout: string }
        err.stdout = JSON.stringify(report)
        cb(err)
      })

      const result = await provider.runScan('/workspace')
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0].warning_type).toBe('XSS')
      expect(result.errors).toEqual(['some error'])
      expect(mockExecFile).toHaveBeenCalledTimes(1)
    })

    it('returns error report when both bundle exec and bare brakeman fail', async () => {
      mockExecFile
        .mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
          cb(new Error('not found'))
        })
        .mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
          cb(new Error('not found'))
        })

      const result = await provider.runScan('/workspace')
      expect(result.warnings).toEqual([])
      expect(result.errors).toEqual(['Brakeman execution failed.'])
      expect(result.scanDuration).toBe(0)
    })

    it('handles invalid JSON gracefully', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error & { stdout: string }) => void) => {
        const err = new Error('bad json') as Error & { stdout: string }
        err.stdout = 'not json'
        cb(err)
      })

      const result = await provider.runScan('/workspace')
      expect(result.warnings).toEqual([])
      expect(result.errors).toEqual(['Brakeman execution failed.'])
    })

    it('handles report with missing fields gracefully', async () => {
      const report = { }
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: null, result: { stdout: string }) => void) => {
        cb(null, { stdout: JSON.stringify(report) })
      })

      const result = await provider.runScan('/workspace')
      expect(result.warnings).toEqual([])
      expect(result.errors).toEqual([])
      expect(result.scanDuration).toBe(0)
    })
  })

  describe('formatMarkdownReport', () => {
    it('returns clean bill message for no warnings', () => {
      const p = new BrakemanProvider()
      const result = p.formatMarkdownReport({ warnings: [], errors: [], scanDuration: 0 })
      expect(result).toContain('0 Security Vulnerabilities Found')
    })

    it('formats warnings with all fields including user_input', () => {
      const p = new BrakemanProvider()
      const report = {
        warnings: [
          { warning_type: 'SQLInjection', warning_code: 0, fingerprint: 'a', message: 'sql inj', file: 'app.rb', line: 10, link: 'https://x.com', confidence: 'High', user_input: 'params[:id]' },
          { warning_type: 'XSS', warning_code: 1, fingerprint: 'b', message: 'xss', file: 'view.erb', line: 5, link: '', confidence: 'Weak' },
        ],
        errors: [],
        scanDuration: 1,
      }
      const result = p.formatMarkdownReport(report)
      expect(result).toContain('**2** security warning(s)')
      expect(result).toContain('[High Confidence] SQLInjection')
      expect(result).toContain('app.rb:10')
      expect(result).toContain('params[:id]')
      expect(result).toContain('[Weak Confidence] XSS')
      // XSS warning has no user_input, so no User Input line for it
    })

    it('formats warning without user_input field', () => {
      const p = new BrakemanProvider()
      const report = {
        warnings: [
          { warning_type: 'CSRF', warning_code: 2, fingerprint: 'c', message: 'csrf issue', file: 'ctrl.rb', line: 3, link: '', confidence: 'Medium' },
        ],
        errors: [],
        scanDuration: 0,
      }
      const result = p.formatMarkdownReport(report)
      expect(result).toContain('[Medium Confidence] CSRF')
      expect(result).not.toContain('User Input')
    })
  })
})
