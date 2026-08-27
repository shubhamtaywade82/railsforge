import { describe, it, expect, vi } from 'vitest'
import * as vscode from 'vscode'
import { DesignPrincipleLinter, PrincipleDiagnostic } from '../src/principles/DesignPrincipleLinter'

describe('DesignPrincipleLinter', () => {
  const linter = new DesignPrincipleLinter()

  it('detects Law of Demeter violations in deep chained calls', () => {
    const lines = [
      'def user_city',
      '  user.account.billing.address.city',
      'end',
    ]

    const list: PrincipleDiagnostic[] = []
    linter['checkLawOfDemeter'](lines, list)

    expect(list.length).toBe(1)
    expect(list[0].id).toBe('DEMETER-VIOLATION')
    expect(list[0].line).toBe(2)
    expect(list[0].demeter).toEqual({ receiver: 'user', method: 'city' })
  })

  it('ignores standard Enumerable and data transformation pipelines for Law of Demeter', () => {
    const lines = [
      'def tool_definitions',
      '  @tools.keys.sort.map do |key|',
      '    key.to_s',
      '  end',
      '  @api_keys = source.api_keys.dup.freeze',
      '  item = self.class.global_queue.shift',
      'end',
    ]

    const list: PrincipleDiagnostic[] = []
    linter['checkLawOfDemeter'](lines, list)

    expect(list.length).toBe(0)
  })

  it('ignores ActiveRecord query builder chains and utility roots for Law of Demeter', () => {
    const lines = [
      'def active_emails',
      '  User.where(active: true).order(:created_at).limit(10).pluck(:email)',
      '  Rails.application.config.action_mailer.default_url_options',
      'end',
    ]

    const list: PrincipleDiagnostic[] = []
    linter['checkLawOfDemeter'](lines, list)

    expect(list.length).toBe(0)
  })

  it('ignores dotted numbers and string literals for Law of Demeter', () => {
    const lines = [
      '  def reveal(ip: "203.0.113.10")',
      "  host = 'api.v1.example.com'",
      '  version = 1.2',
    ]

    const list: PrincipleDiagnostic[] = []
    linter['checkLawOfDemeter'](lines, list)

    expect(list.length).toBe(0)
  })

  it('flags dynamic metaprogramming for KISS principle', () => {
    const lines = [
      'class DynamicModel',
      '  define_method :custom_action do',
      '    # complex logic',
      '  end',
      'end',
    ]

    const list: PrincipleDiagnostic[] = []
    linter['checkKISS'](lines, list)

    expect(list.length).toBe(1)
    expect(list[0].id).toBe('KISS-METAPROGRAMMING')
    expect(list[0].line).toBe(2)
  })

  it('identifies unused private methods for YAGNI principle', () => {
    const lines = [
      'class UserService',
      '  def call',
      '    true',
      '  end',
      '  private',
      '  def unused_dead_method',
      '    123',
      '  end',
      'end',
    ]

    const list: PrincipleDiagnostic[] = []
    linter['checkYAGNI'](lines, list)

    expect(list.length).toBe(1)
    expect(list[0].id).toBe('YAGNI-UNUSED-PRIVATE')
    expect(list[0].line).toBe(6)
    expect(list[0].endLine).toBe(8)
  })

  it('does not flag private methods that are called elsewhere in the file', () => {
    const lines = [
      'class UserService',
      '  def call',
      '    compute_value',
      '  end',
      '  private',
      '  def compute_value',
      '    42',
      '  end',
      'end',
    ]

    const list: PrincipleDiagnostic[] = []
    linter['checkYAGNI'](lines, list)

    expect(list).toHaveLength(0)
  })

  it('flags fat classes in a gem/script lib/ directory without the Rails-specific quick fix', () => {
    const lines = Array.from({ length: 201 }, (_, i) => `  # line ${i}`)
    lines.unshift('class BigGemClass')
    lines.push('end')

    const list: PrincipleDiagnostic[] = []
    linter['checkSRP']('/repo/lib/my_gem/big_gem_class.rb', lines, list)

    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('SRP-FAT-CLASS')
    expect(list[0].quickFixCommand).toBeUndefined()
  })

  it('does not flag a lib/ file that lives under an unrelated app/ workspace path', () => {
    const lines = Array.from({ length: 201 }, () => '  # line')

    const list: PrincipleDiagnostic[] = []
    linter['checkSRP']('/repo/app/lib_looking_dir/lib/thing.rb', lines, list)

    expect(list).toHaveLength(0)
  })

  describe('findMethodEndLine', () => {
    it('returns immediately for single-line methods using = syntax', () => {
      const lines = [
        'class Foo',
        '  def bar = 42',
        '  def baz =(1 + 2)',
        'end',
      ]
      // def bar = 42 is at index 1, should return 1 + 1 = 2 (1-based)
      expect(linter['findMethodEndLine'](lines, 1)).toBe(2)
      // def baz =(1 + 2) is at index 2, should return 2 + 1 = 3
      expect(linter['findMethodEndLine'](lines, 2)).toBe(3)
    })

    it('tracks depth through nested blocks and finds matching end', () => {
      const lines = [
        'class Foo',
        '  def calculate',
        '    if condition',
        '      [1,2,3].each do |x|',
        '        x * 2',
        '      end',
        '    end',
        '    result',
        '  end',
        'end',
      ]
      // def calculate is at index 1, matching end is at index 8 → return 9 (1-based)
      expect(linter['findMethodEndLine'](lines, 1)).toBe(9)
    })

    it('returns defLineIndex + 1 as fallback when no matching end is found', () => {
      const lines = [
        'class Foo',
        '  def incomplete',
        '    if something',
        '      nested',
      ]
      // def incomplete at index 1, no matching end → return 2 (1-based)
      expect(linter['findMethodEndLine'](lines, 1)).toBe(2)
    })
  })

  describe('provideCodeActions', () => {
    function makeDocument(fileName: string, text: string): vscode.TextDocument {
      return new vscode.TextDocument(fileName, 'ruby', text)
    }

    it('provides SRP extract service action for model/controller fat class', () => {
      const doc = makeDocument('/app/models/user.rb', 'class User\nend\n')
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 80),
        '[SRP-FAT-CLASS] ...',
        vscode.DiagnosticSeverity.Information,
      )
      diagnostic.source = 'RailsForge Principles'
      diagnostic.code = 'SRP-FAT-CLASS'

      // Set up metadata
      linter['metadataByDoc'].set(doc.uri.toString(), [{
        id: 'SRP-FAT-CLASS',
        title: 'Single Responsibility Principle Violation',
        message: '...',
        line: 1,
        severity: vscode.DiagnosticSeverity.Information,
        quickFixTitle: 'Extract selection to Service Object',
        quickFixCommand: 'railsforge.extractService',
      }])

      const actions = linter.provideCodeActions(doc, new vscode.Range(0, 0, 0, 80),
        new vscode.CodeActionContext([diagnostic]))

      const extractAction = actions.find(a => a.title === 'Extract selected code to Service Object')
      expect(extractAction).toBeDefined()
      expect((extractAction as unknown as { isPreferred: boolean }).isPreferred).toBe(true)
    })

    it('provides delegate action for Demeter violation in Rails app', () => {
      const text = 'class Order\n  def city\n    user.address.city\n  end\nend\n'
      const doc = makeDocument('/app/models/order.rb', text)
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(2, 0, 2, 80),
        '[DEMETER-VIOLATION] ...',
        vscode.DiagnosticSeverity.Warning,
      )
      diagnostic.source = 'RailsForge Principles'
      diagnostic.code = 'DEMETER-VIOLATION'

      linter['metadataByDoc'].set(doc.uri.toString(), [{
        id: 'DEMETER-VIOLATION',
        title: 'Law of Demeter Violation',
        message: '...',
        line: 3,
        severity: vscode.DiagnosticSeverity.Warning,
        demeter: { receiver: 'user', method: 'city' },
      }])

      const actions = linter.provideCodeActions(doc, new vscode.Range(2, 0, 2, 80),
        new vscode.CodeActionContext([diagnostic]))

      const delegateAction = actions.find(a => a.title.includes('delegate'))
      expect(delegateAction).toBeDefined()
      const edit = (delegateAction as unknown as { edit: vscode.WorkspaceEdit }).edit
      expect(edit._edits).toHaveLength(1)
    })

    it('provides remove action for YAGNI unused private method', () => {
      const text = 'class Foo\n  private\n  def dead\n  end\nend\n'
      const doc = makeDocument('/app/models/foo.rb', text)
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(2, 0, 2, 80),
        '[YAGNI-UNUSED-PRIVATE] ...',
        vscode.DiagnosticSeverity.Hint,
      )
      diagnostic.source = 'RailsForge Principles'
      diagnostic.code = 'YAGNI-UNUSED-PRIVATE'

      linter['metadataByDoc'].set(doc.uri.toString(), [{
        id: 'YAGNI-UNUSED-PRIVATE',
        title: 'Potential YAGNI Violation',
        message: '...',
        line: 3,
        severity: vscode.DiagnosticSeverity.Hint,
        endLine: 4,
      }])

      const actions = linter.provideCodeActions(doc, new vscode.Range(2, 0, 2, 80),
        new vscode.CodeActionContext([diagnostic]))

      const removeAction = actions.find(a => a.title === 'Remove unused method')
      expect(removeAction).toBeDefined()
    })

    it('provides AI fix action for any diagnostic', () => {
      const doc = makeDocument('/app/models/foo.rb', 'class Foo\nend')
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 80),
        '[KISS-METAPROGRAMMING] ...',
        vscode.DiagnosticSeverity.Information,
      )
      diagnostic.source = 'RailsForge Principles'
      diagnostic.code = 'KISS-METAPROGRAMMING'

      linter['metadataByDoc'].set(doc.uri.toString(), [{
        id: 'KISS-METAPROGRAMMING',
        title: 'KISS Principle Warning',
        message: 'Dynamic metaprogramming detected',
        line: 1,
        severity: vscode.DiagnosticSeverity.Information,
      }])

      const actions = linter.provideCodeActions(doc, new vscode.Range(0, 0, 0, 80),
        new vscode.CodeActionContext([diagnostic]))

      const aiAction = actions.find(a => a.title.includes('RailsForge AI'))
      expect(aiAction).toBeDefined()
    })

    it('provides learning resource action for known diagnostic ids', () => {
      const doc = makeDocument('/app/models/foo.rb', 'class Foo\nend')
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 80),
        '[DEMETER-VIOLATION] ...',
        vscode.DiagnosticSeverity.Warning,
      )
      diagnostic.source = 'RailsForge Principles'
      diagnostic.code = 'DEMETER-VIOLATION'

      linter['metadataByDoc'].set(doc.uri.toString(), [{
        id: 'DEMETER-VIOLATION',
        title: 'Law of Demeter Violation',
        message: '...',
        line: 1,
        severity: vscode.DiagnosticSeverity.Warning,
      }])

      const actions = linter.provideCodeActions(doc, new vscode.Range(0, 0, 0, 80),
        new vscode.CodeActionContext([diagnostic]))

      const learnAction = actions.find(a => a.title.includes('Learn:'))
      expect(learnAction).toBeDefined()
      expect(learnAction!.title).toContain('POODR')
    })

    it('skips diagnostics not from RailsForge Principles', () => {
      const doc = makeDocument('/app/models/foo.rb', 'class Foo\nend')
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 80),
        'Some other error',
        vscode.DiagnosticSeverity.Error,
      )
      diagnostic.source = 'Other Linter'

      const actions = linter.provideCodeActions(doc, new vscode.Range(0, 0, 0, 80),
        new vscode.CodeActionContext([diagnostic]))

      expect(actions).toHaveLength(0)
    })

    it('does not provide delegate action for non-Rails files', () => {
      const doc = makeDocument('/lib/my_gem/foo.rb', 'class Foo\nend')
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 80),
        '[DEMETER-VIOLATION] ...',
        vscode.DiagnosticSeverity.Warning,
      )
      diagnostic.source = 'RailsForge Principles'
      diagnostic.code = 'DEMETER-VIOLATION'

      linter['metadataByDoc'].set(doc.uri.toString(), [{
        id: 'DEMETER-VIOLATION',
        title: 'Law of Demeter Violation',
        message: '...',
        line: 1,
        severity: vscode.DiagnosticSeverity.Warning,
        demeter: { receiver: 'user', method: 'city' },
      }])

      const actions = linter.provideCodeActions(doc, new vscode.Range(0, 0, 0, 80),
        new vscode.CodeActionContext([diagnostic]))

      const delegateAction = actions.find(a => a.title.includes('delegate'))
      expect(delegateAction).toBeUndefined()
    })
  })

  describe('buildDelegateEdit', () => {
    it('inserts delegate after the class line with matching indentation', () => {
      const text = 'class Order\n  def city\n    user.address.city\n  end\nend\n'
      const doc = new vscode.TextDocument('/app/models/order.rb', 'ruby', text)

      const edit = linter['buildDelegateEdit'](doc, 2, 'user', 'city')
      expect(edit._edits).toHaveLength(1)
      expect(edit._edits[0].text).toBe('  delegate :city, to: :user\n')
    })

    it('returns empty edit when no class line is found', () => {
      const text = 'def city\n  user.address.city\nend\n'
      const doc = new vscode.TextDocument('/app/models/order.rb', 'ruby', text)

      const edit = linter['buildDelegateEdit'](doc, 1, 'user', 'city')
      expect(edit._edits).toHaveLength(0)
    })
  })

  describe('dispose', () => {
    it('clears metadata and disposes diagnostic collection', () => {
      const doc = new vscode.TextDocument('/app/models/foo.rb', 'ruby', 'class Foo\nend')
      linter['metadataByDoc'].set(doc.uri.toString(), [])

      linter.dispose()
      expect(linter['metadataByDoc'].size).toBe(0)
    })
  })

  describe('updateDiagnostics', () => {
    it('returns early for non-ruby documents', () => {
      const doc = new vscode.TextDocument('/app/models/user.ts', 'typescript', 'const x = 1')
      linter.updateDiagnostics(doc)
      expect(linter['metadataByDoc'].has(doc.uri.toString())).toBe(false)
    })

    it('returns early for untitled documents', () => {
      const doc = new vscode.TextDocument('untitled', 'ruby', 'class Foo\nend')
      doc.isUntitled = true
      linter.updateDiagnostics(doc)
      expect(linter['metadataByDoc'].has(doc.uri.toString())).toBe(false)
    })

    it('runs all checks and sets diagnostics for ruby files', () => {
      const text = [
        'class Order',
        '  def city',
        '    user.account.billing.address.city',
        '  end',
        '  private',
        '  define_method :dynamic do',
        '    nil',
        '  end',
        '  def unused_method',
        '    nil',
        '  end',
        'end',
      ].join('\n')
      const doc = new vscode.TextDocument('/app/models/order.rb', 'ruby', text)

      const setSpy = vi.spyOn(linter['diagnosticCollection'], 'set')
      linter.updateDiagnostics(doc)

      expect(linter['metadataByDoc'].has(doc.uri.toString())).toBe(true)
      const meta = linter['metadataByDoc'].get(doc.uri.toString())!
      expect(meta.length).toBeGreaterThanOrEqual(2) // Demeter + KISS + YAGNI
      expect(meta.some(d => d.id === 'DEMETER-VIOLATION')).toBe(true)
      expect(meta.some(d => d.id === 'KISS-METAPROGRAMMING')).toBe(true)
      expect(meta.some(d => d.id === 'YAGNI-UNUSED-PRIVATE')).toBe(true)
      expect(setSpy).toHaveBeenCalledWith(doc.uri, expect.any(Array))
    })

    it('flags SRP fat class for model with 200+ lines via updateDiagnostics', () => {
      const lines = ['class FatModel']
      for (let i = 0; i < 200; i++) { lines.push('  # comment') }
      lines.push('end')
      const text = lines.join('\n')
      const doc = new vscode.TextDocument('/app/models/fat_model.rb', 'ruby', text)

      linter.updateDiagnostics(doc)

      const meta = linter['metadataByDoc'].get(doc.uri.toString())!
      const srp = meta.find(d => d.id === 'SRP-FAT-CLASS')
      expect(srp).toBeDefined()
      expect(srp!.quickFixCommand).toBe('railsforge.extractService')
    })

    it('flags SRP fat class for lib/ file without quickFixCommand via updateDiagnostics', () => {
      const lines = ['class FatGem']
      for (let i = 0; i < 200; i++) { lines.push('  # comment') }
      lines.push('end')
      const text = lines.join('\n')
      const doc = new vscode.TextDocument('/lib/my_gem/fat_gem.rb', 'ruby', text)

      linter.updateDiagnostics(doc)

      const meta = linter['metadataByDoc'].get(doc.uri.toString())!
      const srp = meta.find(d => d.id === 'SRP-FAT-CLASS')
      expect(srp).toBeDefined()
      expect(srp!.quickFixCommand).toBeUndefined()
    })
  })

  describe('provideCodeActions additional cases', () => {
    function makeDocument(fileName: string, text: string): vscode.TextDocument {
      return new vscode.TextDocument(fileName, 'ruby', text)
    }

    it('does not provide SRP extract for lib/ fat class without quickFixCommand', () => {
      const doc = makeDocument('/lib/my_gem/big.rb', 'class Big\nend\n')
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 80),
        '[SRP-FAT-CLASS] ...',
        vscode.DiagnosticSeverity.Information,
      )
      diagnostic.source = 'RailsForge Principles'
      diagnostic.code = 'SRP-FAT-CLASS'

      linter['metadataByDoc'].set(doc.uri.toString(), [{
        id: 'SRP-FAT-CLASS',
        title: 'Single Responsibility Principle Violation',
        message: '...',
        line: 1,
        severity: vscode.DiagnosticSeverity.Information,
      }])

      const actions = linter.provideCodeActions(doc, new vscode.Range(0, 0, 0, 80),
        new vscode.CodeActionContext([diagnostic]))

      const extractAction = actions.find(a => a.title === 'Extract selected code to Service Object')
      expect(extractAction).toBeUndefined()
    })

    it('still provides AI fix and learning resource when no specific quick fix matches', () => {
      const doc = makeDocument('/app/models/foo.rb', 'class Foo\nend')
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 80),
        '[YAGNI-UNUSED-PRIVATE] ...',
        vscode.DiagnosticSeverity.Hint,
      )
      diagnostic.source = 'RailsForge Principles'
      diagnostic.code = 'YAGNI-UNUSED-PRIVATE'

      // No metadata set → meta will be undefined
      linter['metadataByDoc'].delete(doc.uri.toString())

      const actions = linter.provideCodeActions(doc, new vscode.Range(0, 0, 0, 80),
        new vscode.CodeActionContext([diagnostic]))

      // AI fix is always added regardless of metadata match
      const aiAction = actions.find(a => a.title.includes('RailsForge AI'))
      expect(aiAction).toBeDefined()
      // Learning resource is added for known diagnostic codes
      const learnAction = actions.find(a => a.title.includes('Learn:'))
      expect(learnAction).toBeDefined()
    })

    it('does not add learning resource for unknown diagnostic ids', () => {
      const doc = makeDocument('/app/models/foo.rb', 'class Foo\nend')
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 80),
        '[UNKNOWN-CODE] ...',
        vscode.DiagnosticSeverity.Warning,
      )
      diagnostic.source = 'RailsForge Principles'
      diagnostic.code = 'UNKNOWN-CODE'

      linter['metadataByDoc'].set(doc.uri.toString(), [{
        id: 'UNKNOWN-CODE',
        title: 'Unknown',
        message: '...',
        line: 1,
        severity: vscode.DiagnosticSeverity.Warning,
      }])

      const actions = linter.provideCodeActions(doc, new vscode.Range(0, 0, 0, 80),
        new vscode.CodeActionContext([diagnostic]))

      const learnAction = actions.find(a => a.title.includes('Learn:'))
      expect(learnAction).toBeUndefined()
    })

    it('does not add YAGNI remove action when endLine is missing', () => {
      const doc = makeDocument('/app/models/foo.rb', 'class Foo\nend')
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 80),
        '[YAGNI-UNUSED-PRIVATE] ...',
        vscode.DiagnosticSeverity.Hint,
      )
      diagnostic.source = 'RailsForge Principles'
      diagnostic.code = 'YAGNI-UNUSED-PRIVATE'

      linter['metadataByDoc'].set(doc.uri.toString(), [{
        id: 'YAGNI-UNUSED-PRIVATE',
        title: 'Potential YAGNI Violation',
        message: '...',
        line: 1,
        severity: vscode.DiagnosticSeverity.Hint,
        // no endLine
      }])

      const actions = linter.provideCodeActions(doc, new vscode.Range(0, 0, 0, 80),
        new vscode.CodeActionContext([diagnostic]))

      const removeAction = actions.find(a => a.title === 'Remove unused method')
      expect(removeAction).toBeUndefined()
    })

    it('does not add Demeter delegate when demeter metadata is missing', () => {
      const doc = makeDocument('/app/models/foo.rb', 'class Foo\nend')
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 80),
        '[DEMETER-VIOLATION] ...',
        vscode.DiagnosticSeverity.Warning,
      )
      diagnostic.source = 'RailsForge Principles'
      diagnostic.code = 'DEMETER-VIOLATION'

      linter['metadataByDoc'].set(doc.uri.toString(), [{
        id: 'DEMETER-VIOLATION',
        title: 'Law of Demeter Violation',
        message: '...',
        line: 1,
        severity: vscode.DiagnosticSeverity.Warning,
        // no demeter field
      }])

      const actions = linter.provideCodeActions(doc, new vscode.Range(0, 0, 0, 80),
        new vscode.CodeActionContext([diagnostic]))

      const delegateAction = actions.find(a => a.title.includes('delegate'))
      expect(delegateAction).toBeUndefined()
    })

    it('does not add learning resource when diagnostic code is a number', () => {
      const doc = makeDocument('/app/models/foo.rb', 'class Foo\nend')
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 80),
        'numeric code',
        vscode.DiagnosticSeverity.Warning,
      )
      diagnostic.source = 'RailsForge Principles'
      diagnostic.code = 42

      linter['metadataByDoc'].set(doc.uri.toString(), [{
        id: '42',
        title: 'Numeric Code',
        message: '...',
        line: 1,
        severity: vscode.DiagnosticSeverity.Warning,
      }])

      const actions = linter.provideCodeActions(doc, new vscode.Range(0, 0, 0, 80),
        new vscode.CodeActionContext([diagnostic]))

      const learnAction = actions.find(a => a.title.includes('Learn:'))
      expect(learnAction).toBeUndefined()
    })
  })
})
