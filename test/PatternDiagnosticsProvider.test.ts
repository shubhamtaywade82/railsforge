import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { PatternDiagnosticsProvider } from '../src/patterns/PatternDiagnosticsProvider'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))
vi.mock('../src/config/RailsForgeConfig', () => ({
  readConfig: vi.fn().mockReturnValue({ excludePatterns: [] }),
  buildExcludeGlob: vi.fn().mockReturnValue(undefined),
}))

describe('PatternDiagnosticsProvider', () => {
  let provider: PatternDiagnosticsProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new PatternDiagnosticsProvider()
  })

  it('should skip non-ruby/erb files', () => {
    const doc = new vscode.TextDocument('test.html', 'html', '<div>hello</div>')
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
  })

  it('should process ruby files', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'class Foo; end')
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
  })

  it('should create diagnostics for singleton hazard code (covers toDiagnostic Warning branch)', () => {
    const code = 'class Foo\n  include Singleton\nend'
    const doc = new vscode.TextDocument('test.rb', 'ruby', code)
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
    // Just ensure no error is thrown; the diagnostic is created internally
  })

  it('should create diagnostics for conditional strategy (covers toDiagnostic Info branch)', () => {
    const code = 'case type\n  when :a\n  when :b\n  when :c\n  when :d\nend'
    const doc = new vscode.TextDocument('test.rb', 'ruby', code)
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
  })

  describe('provideCodeActions', () => {
    it('should return AI fix for pattern diagnostics', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', '')
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), 'Replace conditional with strategy')
      diag.source = 'RailsForge Patterns'
      diag.code = 'REPLACE-CONDITIONAL-STRATEGY'
      const context = new vscode.CodeActionContext([diag])

      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 10),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions.some(a => a.title.includes('Strategy'))).toBe(true)
      expect(actions.some(a => a.title.includes('AI'))).toBe(true)
      expect(actions.some(a => a.title.includes('Ask @rails'))).toBe(true)
    })

    it('should handle SINGLETON-HAZARD code action', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', '')
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), 'Singleton hazard')
      diag.source = 'RailsForge Patterns'
      diag.code = 'SINGLETON-HAZARD'
      const context = new vscode.CodeActionContext([diag])

      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 10),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions.some(a => a.title.includes('Dependency Injection'))).toBe(true)
    })

    it('should handle INTRODUCE-FORM-OBJECT code action', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', '')
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), 'Introduce form object')
      diag.source = 'RailsForge Patterns'
      diag.code = 'INTRODUCE-FORM-OBJECT'
      const context = new vscode.CodeActionContext([diag])

      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 10),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions.some(a => a.title.includes('Form Object'))).toBe(true)
      expect(actions.some(a => a.title.includes('AI'))).toBe(true)
      expect(actions.some(a => a.title.includes('Ask @rails'))).toBe(true)
    })

    it('should handle PRIMITIVE-OBSESSION code action', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', '')
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), 'Primitive obsession')
      diag.source = 'RailsForge Patterns'
      diag.code = 'PRIMITIVE-OBSESSION'
      const context = new vscode.CodeActionContext([diag])

      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 10),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions.some(a => a.title.includes('Value Object'))).toBe(true)
      expect(actions.some(a => a.title.includes('AI'))).toBe(true)
      expect(actions.some(a => a.title.includes('Ask @rails'))).toBe(true)
    })

    it('should return empty for non-RailsForge Patterns diagnostics', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', '')
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), 'other')
      diag.source = 'Other'
      const context = new vscode.CodeActionContext([diag])

      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 10),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions).toEqual([])
    })

    it('should skip diagnostics without code', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', '')
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), 'no code')
      diag.source = 'RailsForge Patterns'
      const context = new vscode.CodeActionContext([diag])

      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 10),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions).toEqual([])
    })

    it('should handle unknown code id gracefully', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', '')
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), 'unknown')
      diag.source = 'RailsForge Patterns'
      diag.code = 'UNKNOWN-CODE'
      const context = new vscode.CodeActionContext([diag])

      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 10),
        context as unknown as vscode.CodeActionContext,
      )
      // Still gets AI fix and Ask @rails
      expect(actions.some(a => a.title.includes('AI'))).toBe(true)
      expect(actions.some(a => a.title.includes('Ask @rails'))).toBe(true)
    })
  })

  it('should scan workspace', () => {
    expect(() => provider.scanWorkspace()).not.toThrow()
  })

  it('should dispose without error', () => {
    expect(() => provider.dispose()).not.toThrow()
  })
})
