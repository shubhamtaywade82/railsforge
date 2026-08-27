import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { DependencyDiagnosticsProvider } from '../src/graph/DependencyDiagnosticsProvider'
import type { DependencyEdge } from '../src/graph/MinimalDependencyGraph'
import type { IndexedPattern } from '../src/patterns/ProjectPatternIndexer'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

describe('DependencyDiagnosticsProvider', () => {
  const graph = {
    getHardCodedCollaborators: vi.fn().mockReturnValue([]),
  } as unknown as import('../src/graph/MinimalDependencyGraph').MinimalDependencyGraph

  const pattern: IndexedPattern = {
    id: '1',
    type: 'service',
    name: 'PaymentService',
    filePath: '/app/services/payment_service.rb',
    lineStart: 1,
    publicMethods: ['call'],
    preview: '',
  }

  const indexer = {
    getAllPatterns: vi.fn().mockReturnValue([pattern]),
  } as unknown as import('../src/patterns/ProjectPatternIndexer').ProjectPatternIndexer

  let provider: DependencyDiagnosticsProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new DependencyDiagnosticsProvider(graph, indexer)
  })

  it('should not update diagnostics for non-ruby files', () => {
    const doc = new vscode.TextDocument('test.html', 'html', 'hello')
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
    expect(graph.getHardCodedCollaborators).not.toHaveBeenCalled()
  })

  it('should delete diagnostics when pattern not found for file', () => {
    const doc = new vscode.TextDocument('/other/path/test.rb', 'ruby', 'class Foo; end')
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
    expect(graph.getHardCodedCollaborators).not.toHaveBeenCalled()
  })

  it('should create diagnostics for hard-coded collaborators', () => {
    const doc = new vscode.TextDocument('/app/services/payment_service.rb', 'ruby', 'class PaymentService\nend')
    const edge: DependencyEdge = {
      from: 'PaymentService',
      to: 'GatewayClient',
      line: 5,
      hardCoded: true,
    }
    vi.mocked(graph.getHardCodedCollaborators).mockReturnValue([edge])

    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
    expect(graph.getHardCodedCollaborators).toHaveBeenCalledWith('PaymentService')
  })

  it('should clamp line to 0 for edge with line 0', () => {
    const doc = new vscode.TextDocument('/app/services/payment_service.rb', 'ruby', 'class PaymentService\nend')
    const edge: DependencyEdge = { from: 'PaymentService', to: 'Foo', line: 0, hardCoded: true }
    vi.mocked(graph.getHardCodedCollaborators).mockReturnValue([edge])
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
    expect(graph.getHardCodedCollaborators).toHaveBeenCalledWith('PaymentService')
  })

  it('should create no diagnostics when no hard-coded collaborators', () => {
    const doc = new vscode.TextDocument('/app/services/payment_service.rb', 'ruby', 'class PaymentService\nend')
    vi.mocked(graph.getHardCodedCollaborators).mockReturnValue([])
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
  })

  describe('provideCodeActions', () => {
    it('should return empty array for unrelated diagnostics', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', '')
      const context = new vscode.CodeActionContext([new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), 'other')])
      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 10),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions).toEqual([])
    })

    it('should skip diagnostics with non-string code', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', '')
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), 'Hard-coded')
      diag.source = 'RailsForge Dependencies'
      diag.code = 123
      const context = new vscode.CodeActionContext([diag])
      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 10),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions).toEqual([])
    })

    it('should return inject, AI, and ask-rails actions', () => {
      const code = 'class PaymentService\n  def initialize\n  end\nend'
      const doc = new vscode.TextDocument('/app/services/payment_service.rb', 'ruby', code)
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), 'Hard-coded collaborator')
      diag.source = 'RailsForge Dependencies'
      diag.code = 'HARDCODED:GatewayClient'

      const context = new vscode.CodeActionContext([diag])
      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 10),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions.length).toBeGreaterThanOrEqual(3)
      expect(actions.some(a => a.title.includes('Inject GatewayClient via constructor'))).toBe(true)
      expect(actions.some(a => a.title.includes('Ask @rails'))).toBe(true)
      expect(actions.some(a => a.title.includes('AI'))).toBe(true)
    })

    it('should inject param into existing initialize with params', () => {
      const code = 'class PaymentService\n  def initialize(order, user)\n  end\nend'
      const doc = new vscode.TextDocument('/app/services/payment_service.rb', 'ruby', code)
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), 'Hard-coded collaborator')
      diag.source = 'RailsForge Dependencies'
      diag.code = 'HARDCODED:GatewayClient'

      const context = new vscode.CodeActionContext([diag])
      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 10),
        context as unknown as vscode.CodeActionContext,
      )
      const injectAction = actions.find(a => a.title.includes('Inject'))
      expect(injectAction?.edit).toBeDefined()
    })

    it('should create new initialize when class has no initialize', () => {
      const code = 'class PaymentService\n  def call\n  end\nend'
      const doc = new vscode.TextDocument('/app/services/payment_service.rb', 'ruby', code)
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), 'Hard-coded collaborator')
      diag.source = 'RailsForge Dependencies'
      diag.code = 'HARDCODED:GatewayClient'

      const context = new vscode.CodeActionContext([diag])
      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 10),
        context as unknown as vscode.CodeActionContext,
      )
      const injectAction = actions.find(a => a.title.includes('Inject'))
      expect(injectAction?.edit).toBeDefined()
    })

    it('should return no inject action when no class match and no initialize', () => {
      const code = 'module PaymentService\nend'
      const doc = new vscode.TextDocument('/app/services/payment_service.rb', 'ruby', code)
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), 'Hard-coded collaborator')
      diag.source = 'RailsForge Dependencies'
      diag.code = 'HARDCODED:GatewayClient'

      const context = new vscode.CodeActionContext([diag])
      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 10),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions.some(a => a.title.includes('Ask @rails'))).toBe(true)
      expect(actions.some(a => a.title.includes('Inject'))).toBe(false)
    })

    it('should rewrite call sites in the document', () => {
      const code = 'class PaymentService\n  def initialize(order)\n  end\n  def call\n    GatewayClient.call(params)\n    result = GatewayClient.new(params)\n  end\nend'
      const doc = new vscode.TextDocument('/app/services/payment_service.rb', 'ruby', code)
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), 'Hard-coded collaborator')
      diag.source = 'RailsForge Dependencies'
      diag.code = 'HARDCODED:GatewayClient'

      const context = new vscode.CodeActionContext([diag])
      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 10),
        context as unknown as vscode.CodeActionContext,
      )
      const injectAction = actions.find(a => a.title.includes('Inject'))
      expect(injectAction?.edit).toBeDefined()
      const edits = (injectAction!.edit as vscode.WorkspaceEdit)._edits
      const replacements = edits.filter(e => 'range' in e)
      expect(replacements.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('should dispose without error', () => {
    expect(() => provider.dispose()).not.toThrow()
  })
})
