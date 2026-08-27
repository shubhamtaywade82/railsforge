import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { RailsDeprecationLinter } from '../src/lint/RailsDeprecationLinter'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

describe('RailsDeprecationLinter', () => {
  let linter: RailsDeprecationLinter
  const env = { majorRailsVersion: 6 } as import('../src/environment/EnvironmentDetector').ProjectEnvironment

  beforeEach(() => {
    vi.clearAllMocks()
    linter = new RailsDeprecationLinter()
  })

  it('should skip non-ruby/erb files', () => {
    const doc = new vscode.TextDocument('test.html', 'html', 'update_attributes(name: "x")')
    linter.updateDiagnostics(doc as unknown as vscode.TextDocument, env)
  })

  it('should detect update_attributes deprecation', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'user.update_attributes(name: "x")')
    linter.updateDiagnostics(doc as unknown as vscode.TextDocument, env)
  })

  it('should detect update_attributes! deprecation', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'user.update_attributes!(name: "x")')
    linter.updateDiagnostics(doc as unknown as vscode.TextDocument, env)
  })

  it('should detect render :text deprecation', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'render :text => "hello"')
    linter.updateDiagnostics(doc as unknown as vscode.TextDocument, env)
  })

  it('should detect before_filter deprecation', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'before_filter :authenticate')
    linter.updateDiagnostics(doc as unknown as vscode.TextDocument, env)
  })

  it('should detect after_filter deprecation', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'after_filter :set_locale')
    linter.updateDiagnostics(doc as unknown as vscode.TextDocument, env)
  })

  it('should detect around_filter deprecation', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'around_filter :wrap_in_transaction')
    linter.updateDiagnostics(doc as unknown as vscode.TextDocument, env)
  })

  it('should process erb files', () => {
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<%= user.update_attributes(name: "x") %>')
    linter.updateDiagnostics(doc as unknown as vscode.TextDocument, env)
  })

  it('should not flag deprecations for Rails 4', () => {
    const oldEnv = { majorRailsVersion: 4 } as import('../src/environment/EnvironmentDetector').ProjectEnvironment
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'user.update_attributes(name: "x")')
    linter.updateDiagnostics(doc as unknown as vscode.TextDocument, oldEnv)
  })

  it('should produce no diagnostics for clean ruby code', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'user.update(name: "x")')
    linter.updateDiagnostics(doc as unknown as vscode.TextDocument, env)
  })

  describe('provideCodeActions', () => {
    it('should return replacement fix for update_attributes', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', 'user.update_attributes(name: "x")')
      const diag = new vscode.Diagnostic(
        new vscode.Range(0, 5, 0, 21),
        'update_attributes is deprecated',
        1,
      )
      diag.source = 'RailsForge'
      diag.code = 'RAILS-DEP-001'
      const context = new vscode.CodeActionContext([diag])

      const actions = linter.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 30),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions.some(a => a.title.includes('Replace with update'))).toBe(true)
      expect(actions.some(a => a.title.includes('AI'))).toBe(true)
    })

    it('should return replacement fix for render :text', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', 'render :text => "hello"')
      const diag = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 18),
        'render :text is deprecated',
        1,
      )
      diag.source = 'RailsForge'
      diag.code = 'RAILS-DEP-002'
      const context = new vscode.CodeActionContext([diag])

      const actions = linter.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 20),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions.some(a => a.title.includes('render plain:'))).toBe(true)
    })

    it('should return replacement fix for before_filter', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', 'before_filter :authenticate')
      const diag = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 14),
        'before_filter is removed',
        1,
      )
      diag.source = 'RailsForge'
      diag.code = 'RAILS-DEP-003'
      const context = new vscode.CodeActionContext([diag])

      const actions = linter.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 20),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions.some(a => a.title.includes('$1_action'))).toBe(true)
    })

    it('should return empty for unknown diagnostic codes', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', 'user.update_attributes(name: "x")')
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 5), 'test')
      diag.source = 'RailsForge'
      diag.code = 'UNKNOWN'
      const context = new vscode.CodeActionContext([diag])

      const actions = linter.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 5),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions.some(a => a.title.includes('AI'))).toBe(true)
      expect(actions.some(a => a.title.includes('Replace'))).toBe(false)
    })

    it('should skip diagnostics without source', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', 'user.update_attributes(name: "x")')
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 5), 'test')
      diag.source = 'Other'
      diag.code = 'RAILS-DEP-001'
      const context = new vscode.CodeActionContext([diag])

      const actions = linter.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 5),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions).toEqual([])
    })

    it('should skip diagnostics without code', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', 'user.update_attributes(name: "x")')
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 5), 'test')
      diag.source = 'RailsForge'
      const context = new vscode.CodeActionContext([diag])

      const actions = linter.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 5),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions).toEqual([])
    })
  })

  it('should dispose without error', () => {
    expect(() => linter.dispose()).not.toThrow()
  })
})
