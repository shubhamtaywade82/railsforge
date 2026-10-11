import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BundlerAuditScanner } from '../src/lint/BundlerAuditScanner'
import type { BundlerAuditReport } from '../src/lint/BundlerAuditScanner'

const execFileMock = vi.fn()
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}))
vi.mock('util', () => ({ promisify: (fn: unknown) => fn }))

describe('BundlerAuditScanner', () => {
  let scanner: BundlerAuditScanner

  beforeEach(() => {
    vi.clearAllMocks()
    scanner = new BundlerAuditScanner()
  })

  describe('formatReport', () => {
    it('should format clean report', () => {
      const report: BundlerAuditReport = { vulnerabilities: [], unpatchedGems: 0 }
      const result = scanner.formatReport(report)
      expect(result).toContain('0 Vulnerable')
      expect(result).toContain('bundle-audit')
    })

    it('should format report with vulnerabilities', () => {
      const report: BundlerAuditReport = {
        vulnerabilities: [
          {
            gemName: 'rails',
            version: '7.0.0',
            cve: 'CVE-2024-0001',
            title: 'CVE-2024-0001: XSS vulnerability',
            url: 'https://example.com',
            criticality: 'High',
          },
        ],
        unpatchedGems: 1,
      }
      const result = scanner.formatReport(report)
      expect(result).toContain('rails')
      expect(result).toContain('High')
      expect(result).toContain('CVE-2024-0001')
      expect(result).toContain('https://example.com')
    })

    it('should handle vulnerability without url', () => {
      const report: BundlerAuditReport = {
        vulnerabilities: [
          {
            gemName: 'devise',
            version: '4.9.0',
            cve: 'CVE-2024-0002',
            title: 'Auth bypass',
            url: '',
            criticality: 'Medium',
          },
        ],
        unpatchedGems: 1,
      }
      const result = scanner.formatReport(report)
      expect(result).toContain('devise')
      expect(result).not.toContain('[Reference]')
    })

    it('should format multiple vulnerabilities', () => {
      const report: BundlerAuditReport = {
        vulnerabilities: [
          { gemName: 'rails', version: '7.0.0', cve: 'CVE-1', title: 'XSS', url: '', criticality: 'High' },
          { gemName: 'devise', version: '4.9.0', cve: 'CVE-2', title: 'Auth', url: '', criticality: 'Low' },
        ],
        unpatchedGems: 2,
      }
      const result = scanner.formatReport(report)
      expect(result).toContain('2')
      expect(result).toContain('rails')
      expect(result).toContain('devise')
    })
  })

  describe('runAudit', () => {
    it('should return empty report when both commands fail', async () => {
      execFileMock.mockRejectedValue(new Error('not found'))
      const result = await scanner.runAudit('/nonexistent')
      expect(result.vulnerabilities).toEqual([])
      expect(result.unpatchedGems).toBe(0)
    })

    it('should parse successful audit output from bundle', async () => {
      const auditOutput = JSON.stringify({
        results: [{
          gem: { name: 'rails', version: '7.0.0' },
          advisory: { cve: 'CVE-2024-0001', title: 'XSS', url: 'https://example.com', criticality: 'High' },
        }],
      })
      execFileMock.mockResolvedValue({ stdout: auditOutput })

      const result = await scanner.runAudit('/workspace')
      expect(result.vulnerabilities).toHaveLength(1)
      expect(result.vulnerabilities[0].gemName).toBe('rails')
      expect(result.vulnerabilities[0].cve).toBe('CVE-2024-0001')
    })

    it('should parse audit output with missing fields', async () => {
      const auditOutput = JSON.stringify({ results: [{}] })
      execFileMock.mockResolvedValue({ stdout: auditOutput })

      const result = await scanner.runAudit('/workspace')
      expect(result.vulnerabilities).toHaveLength(1)
      expect(result.vulnerabilities[0].gemName).toBe('unknown')
      expect(result.vulnerabilities[0].cve).toBe('CVE-UNKNOWN')
    })

    it('should handle audit error with stdout containing JSON', async () => {
      const auditOutput = JSON.stringify({
        results: [{
          gem: { name: 'nokogiri', version: '1.14.0' },
          advisory: { cve: 'CVE-2024-0003', title: 'XML injection', url: '', criticality: 'Medium' },
        }],
      })
      const execErr = new Error('exit 1') as Error & { stdout?: string }
      execErr.stdout = auditOutput
      execFileMock.mockRejectedValue(execErr)

      const result = await scanner.runAudit('/workspace')
      expect(result.vulnerabilities).toHaveLength(1)
      expect(result.vulnerabilities[0].gemName).toBe('nokogiri')
    })

    it('should handle invalid JSON in audit output', async () => {
      execFileMock.mockRejectedValue({ stdout: 'invalid json' })
      const result = await scanner.runAudit('/workspace')
      expect(result.vulnerabilities).toEqual([])
    })

    it('should handle audit error without stdout', async () => {
      execFileMock.mockRejectedValue(new Error('command not found'))
      const result = await scanner.runAudit('/workspace')
      expect(result.vulnerabilities).toEqual([])
    })
  })
})
