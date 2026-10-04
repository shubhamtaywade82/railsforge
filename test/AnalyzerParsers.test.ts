import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { analyzerCommand, parseAnalyzerOutput, parseDebride, parseFlay, parseFlog, parseReek, parseStandard } from '../src/lint/AnalyzerParsers'

const fixture = (name: string): string => fs.readFileSync(path.resolve(__dirname, 'fixtures', 'analyzers', name), 'utf8')

describe('analyzer parsers (real tool output)', () => {
  it('reek: smells with context, line span and smell type', () => {
    const findings = parseReek(fixture('reek.json'))
    const control = findings.find(f => f.code === 'ControlParameter')!
    expect(control).toMatchObject({ analyzer: 'reek', file: 'app/a.rb', line: 3, message: "Greeter#greet is controlled by argument 'loud'" })
    expect(findings.every(f => f.analyzer === 'reek' && f.line >= 1 && (f.endLine ?? f.line) >= f.line)).toBe(true)
    expect(findings.length).toBeGreaterThan(3)
  })

  it('flog: only methods at/above the threshold, with line ranges', () => {
    const findings = parseFlog(fixture('flog.txt'), 15)
    expect(findings.map(f => `${f.file}:${f.line}-${f.endLine}`)).toEqual(['app/a.rb:12-14', 'app/b.rb:2-4'])
    expect(findings[0].message).toContain('Greeter#dup_a')
    expect(findings[0].message).toContain('17.7')
    expect(parseFlog(fixture('flog.txt'), 0).length).toBe(4)
    expect(parseFlog(fixture('flog.txt'), 100)).toEqual([])
  })

  it('flay: one finding per location, cross-referencing the others', () => {
    const findings = parseFlay(fixture('flay.txt'))
    expect(findings.map(f => `${f.file}:${f.line}`)).toEqual(['app/a.rb:12', 'app/b.rb:2'])
    expect(findings[0].message).toContain('app/b.rb:2')
    expect(findings[0].severity).toBe('info')
  })

  it('debride: attributes methods to their class heading', () => {
    const findings = parseDebride(fixture('debride.txt'))
    const unused = findings.find(f => f.message.startsWith('Greeter#unused_method'))!
    expect(unused).toMatchObject({ file: 'app/a.rb', line: 16, endLine: 18, severity: 'hint' })
    expect(findings.some(f => f.message.startsWith('Other#dup_b'))).toBe(true)
  })

  it('standard: maps RuboCop-schema offenses', () => {
    const findings = parseStandard(fixture('standard.json'))
    const semicolon = findings.find(f => f.code === 'Layout/SpaceBeforeSemicolon')!
    expect(semicolon).toMatchObject({ analyzer: 'standard', file: 'app/c.rb', line: 2, severity: 'info' })
  })
})

describe('robustness', () => {
  it('returns [] for empty / malformed output', () => {
    for (const id of ['reek', 'flog', 'flay', 'debride', 'standard'] as const) {
      expect(parseAnalyzerOutput(id, '', { flogThreshold: 20 })).toEqual([])
      expect(parseAnalyzerOutput(id, 'garbage {', { flogThreshold: 20 })).toEqual([])
    }
  })

  it('builds argv commands without shell syntax', () => {
    expect(analyzerCommand('reek', ['app'])).toEqual({ tool: 'reek', args: ['--format', 'json', 'app'] })
    expect(analyzerCommand('standard', ['app', 'lib']).tool).toBe('standardrb')
  })
})
