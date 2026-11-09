import { describe, it, expect } from 'vitest'
import * as vscode from 'vscode'
import { RubyAstParser } from '../src/indexer/RubyAstParser'
import { RefactoringEngine } from '../src/refactoring-intelligence/core/RefactoringEngine'
import { RefactoringAdvisor } from '../src/refactoring-intelligence/core/RefactoringAdvisor'
import { TargetResolver } from '../src/refactoring-intelligence/core/ScopeResolver'
import { ObservationStore, recordRefinement } from '../src/refactoring-intelligence/core/ObservationStore'
import type { Recommendation, ScopeRef } from '../src/refactoring-intelligence/core/types'
import { relativeTo } from '../src/refactoring-intelligence/vscode/workspacePaths'
import { REVIEW_AI_HINTS_COMMAND, SUGGEST_REFACTORINGS_COMMAND } from '../src/refactoring-intelligence/vscode/RefactoringCommand'
import { RefactoringCodeLensProvider } from '../src/providers/RefactoringCodeLensProvider'
import { RefactoringCodeActionProvider, REFACTORING_ACTION_KIND } from '../src/providers/RefactoringCodeActionProvider'

const ROOT = '/proj'
const PATH = 'app/controllers/orders_controller.rb'
const CONTROLLER = [
  'class OrdersController < ApplicationController',
  '  def create',
  '    @order = Order.new(order_params)',
  '',
  '    if @order.save',
  '      InventoryService.new.reserve(@order)',
  '      PaymentGateway.new.charge(@order)',
  '      OrderMailer.confirmation(@order).deliver_later',
  '',
  '      redirect_to @order',
  '    else',
  '      render :new',
  '    end',
  '  end',
  'end',
  '',
].join('\n')
const CREATE: ScopeRef = { kind: 'method', name: 'create', className: 'OrdersController', startLine: 2, endLine: 14 }
const ENVY = ['class Report', '  def summary(order)', '    order.total + order.tax + order.discount + order.shipping', '  end', 'end', ''].join('\n')

/** A fingerprint that never changes: for tests that are about the scope's own text. */
const steady = async () => 'fp-1'

function document(text: string, file = PATH, languageId = 'ruby') {
  return {
    languageId,
    uri: { fsPath: `${ROOT}/${file}`, scheme: 'file' },
    getText: () => text,
  } as unknown as vscode.TextDocument
}

/** Zero-based line/character range as VS Code passes it. */
function cursor(line: number, character = 0): vscode.Range {
  return { start: { line, character }, end: { line, character }, isEmpty: true } as unknown as vscode.Range
}

const pathOf = (uri: vscode.Uri) => relativeTo(ROOT, uri.fsPath)
const engine = () => new RefactoringEngine(new RubyAstParser())

function rec(id: string, scope: ScopeRef, confidence: Recommendation['confidence'] = 'medium'): Recommendation {
  return {
    id,
    source: 'ai',
    candidateIds: ['c1'],
    path: PATH,
    scope,
    title: `AI hint ${id}`,
    problem: 'p',
    evidence: [],
    confidence,
    priority: 'high',
    technique: { id: 'service-object', name: 'Service Object' },
    design: 'd',
    alternatives: [],
    benefit: 'b',
    risk: 'r',
    affectedFiles: [PATH],
    steps: [],
    verification: [],
  }
}

function setup(options: { content?: string; fingerprint?: (p: string, c: string, s: ScopeRef) => Promise<string>; store?: ObservationStore } = {}) {
  const content = options.content ?? CONTROLLER
  const eng = engine()
  const observations = options.store ?? new ObservationStore()
  const fingerprint = options.fingerprint ?? (async () => 'fp-1')
  const lens = new RefactoringCodeLensProvider({ engine: eng, observations, fingerprint, pathOf, enabled: () => true })
  const action = new RefactoringCodeActionProvider({ engine: eng, resolver: new TargetResolver(), observations, fingerprint, pathOf })
  return { eng, observations, lens, action, content, fingerprint }
}

/** A real advisor, used only for its context fingerprint (the agent is never called). */
function advisorFor(files: Map<string, string>): RefactoringAdvisor {
  return new RefactoringAdvisor({
    agent: { run: async () => ({ success: false, response: 'not called' }) },
    index: {
      findDefiningFiles: name => (name.startsWith('TaxTable') ? [{ relativePath: 'app/services/tax_table.rb' }] : []),
      incomingDependencies: () => [],
    },
    files: { read: async path => files.get(path) },
    catalog: { listCatalog: () => [], listProjectInstances: () => [] },
    checkSyntax: async () => ({ status: 'ok' }),
  })
}

describe('CodeLens: observed, reviewed and rule-based lenses', () => {
  it('shows the rule-based lens when nothing has been observed, linking to the command that asks the AI', async () => {
    const { lens, content } = setup()
    const doc = document(content)
    const [only] = await lens.provideCodeLenses(doc)
    expect(only.range.start.line).toBe(1)
    expect(only.command).toMatchObject({ title: '✦ RailsForge: 1 refactoring opportunity · high', command: SUGGEST_REFACTORINGS_COMMAND })
    expect(only.command?.arguments?.[0]).toBe(doc.uri)
  })

  it('replaces it with an observed-hints lens that reviews, without asking the AI', async () => {
    const { lens, observations, content } = setup()
    await recordRefinement(observations, PATH, content, CREATE, [rec('r1', CREATE)], [], steady)
    const [only] = await lens.provideCodeLenses(document(content))
    expect(only.command).toMatchObject({ title: '✦ AI: 1 hint observed · high', command: REVIEW_AI_HINTS_COMMAND })
  })

  it('says the AI reviewed the scope and found nothing to change there', async () => {
    const { lens, observations, content } = setup()
    await recordRefinement(observations, PATH, content, CREATE, [], [{ reason: 'one step only' }], steady)
    const [only] = await lens.provideCodeLenses(document(content))
    expect(only.command?.title).toBe('✦ AI reviewed: nothing to change at this level')
    expect(only.command?.command).toBe(REVIEW_AI_HINTS_COMMAND)
  })

  it('keeps a stronger rule-based lens when the AI observed only low-confidence items', async () => {
    const { lens, observations, content } = setup()
    await recordRefinement(observations, PATH, content, CREATE, [rec('low', CREATE, 'low')], [], steady)
    const [only] = await lens.provideCodeLenses(document(content))
    expect(only.command).toMatchObject({ title: '✦ RailsForge: 1 refactoring opportunity · high', command: SUGGEST_REFACTORINGS_COMMAND })
  })

  it('shows nothing for a low-confidence rule-based finding, and nothing when disabled or outside the project', async () => {
    const low = setup({ content: ENVY })
    expect(await low.lens.provideCodeLenses(document(ENVY, 'app/services/report.rb'))).toEqual([])

    const { eng, observations, fingerprint, content } = setup()
    const off = new RefactoringCodeLensProvider({ engine: eng, observations, fingerprint, pathOf, enabled: () => false })
    expect(await off.provideCodeLenses(document(content))).toEqual([])
    const outside = new RefactoringCodeLensProvider({ engine: eng, observations, fingerprint, pathOf: () => undefined, enabled: () => true })
    expect(await outside.provideCodeLenses(document(content))).toEqual([])
    const erb = setup()
    expect(await erb.lens.provideCodeLenses(document(erb.content, PATH, 'erb'))).toEqual([])
  })

  it('falls back to the rule-based lens when the scope\'s own text changes', async () => {
    const { lens, observations, content } = setup()
    await recordRefinement(observations, PATH, content, CREATE, [rec('r1', CREATE)], [], steady)
    const edited = content.replace('InventoryService.new.reserve(@order)', 'Inventory.reserve(@order)')
    const [only] = await lens.provideCodeLenses(document(edited))
    expect(only.command?.command).toBe(SUGGEST_REFACTORINGS_COMMAND)
  })

  it('keeps the observed hint when an edit happens outside the scope', async () => {
    const { lens, observations, content } = setup()
    await recordRefinement(observations, PATH, content, CREATE, [rec('r1', CREATE)], [], steady)
    const [only] = await lens.provideCodeLenses(document(`# a note above the class\n${content}`))
    expect(only.command?.command).toBe(REVIEW_AI_HINTS_COMMAND)
  })

  it('stops showing an observed hint once a file it depends on changed, even though the scope did not', async () => {
    const files = new Map<string, string>([
      [PATH, ''],
      ['app/services/tax_table.rb', 'class TaxTable\n  RATE = 0.2\nend\n'],
    ])
    const advisor = advisorFor(files)
    const content = ['class Pricing', '  def gross(x)', '    x + TaxTable::RATE * x', '  end', 'end', ''].join('\n')
    const scope: ScopeRef = { kind: 'method', name: 'gross', className: 'Pricing', startLine: 2, endLine: 4 }
    const fingerprint = (p: string, c: string, s: ScopeRef) => advisor.fingerprint(p, c, s)
    const observations = new ObservationStore()
    await recordRefinement(observations, PATH, content, scope, [rec('r1', scope)], [], s => fingerprint(PATH, content, s))
    const lens = new RefactoringCodeLensProvider({ engine: engine(), observations, fingerprint, pathOf, enabled: () => true })

    const before = await lens.provideCodeLenses(document(content))
    expect(before.map(l => l.command?.command)).toEqual([REVIEW_AI_HINTS_COMMAND])

    files.set('app/services/tax_table.rb', 'class TaxTable\n  RATE = 0.25\nend\n')
    const after = await lens.provideCodeLenses(document(content))
    expect(after.some(l => l.command?.command === REVIEW_AI_HINTS_COMMAND)).toBe(false)
  })

  it('asks VS Code for new lenses when an observation is recorded (the extension wires store to lens)', async () => {
    const { lens, observations, content } = setup()
    let refreshed = 0
    lens.onDidChangeCodeLenses(() => { refreshed++ })
    observations.onDidChange(() => lens.refresh())
    await recordRefinement(observations, PATH, content, CREATE, [], [], steady)
    expect(refreshed).toBeGreaterThan(0)
  })
})

describe('lightbulb: the same precedence as the CodeLens', () => {
  it('offers the observed hints, and only those', async () => {
    const { action, observations, content } = setup()
    await recordRefinement(observations, PATH, content, CREATE, [rec('r1', CREATE)], [], steady)
    const items = await action.provideCodeActions(document(content), cursor(2, 4), {} as never, {} as never)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('RailsForge: 1 AI hint observed for method OrdersController#create')
    expect(items[0].command?.command).toBe(REVIEW_AI_HINTS_COMMAND)
    expect(items[0].kind?.value).toBe(REFACTORING_ACTION_KIND.value)
  })

  it('offers the reviewed result, so the reasons can be read', async () => {
    const { action, observations, content } = setup()
    await recordRefinement(observations, PATH, content, CREATE, [], [{ reason: 'one step' }], steady)
    const [item] = await action.provideCodeActions(document(content), cursor(2, 4), {} as never, {} as never)
    expect(item.title).toBe('RailsForge: AI reviewed method OrdersController#create: nothing to change')
  })

  it('still offers the rule-based suggestion when the AI observed only low-confidence items', async () => {
    const { action, observations, content } = setup()
    await recordRefinement(observations, PATH, content, CREATE, [rec('low', CREATE, 'low')], [], steady)
    const [item] = await action.provideCodeActions(document(content), cursor(2, 4), {} as never, {} as never)
    expect(item.title).toBe('RailsForge: 1 refactoring suggestion for method OrdersController#create')
    expect(item.command?.command).toBe(SUGGEST_REFACTORINGS_COMMAND)
  })

  it('offers the rule-based suggestion when nothing has been observed', async () => {
    const { action, content } = setup()
    const [item] = await action.provideCodeActions(document(content), cursor(2, 4), {} as never, {} as never)
    expect(item.title).toBe('RailsForge: 1 refactoring suggestion for method OrdersController#create')
    expect(item.edit).toBeUndefined()
  })

  it('offers nothing where the cursor is outside every scope, for low-confidence findings, and for non-Ruby files', async () => {
    const script = "puts 'hello'\n"
    const outside = setup({ content: script })
    expect(await outside.action.provideCodeActions(document(script, 'app/services/script.rb'), cursor(0), {} as never, {} as never)).toEqual([])

    const envy = setup({ content: ENVY })
    expect(await envy.action.provideCodeActions(document(ENVY, 'app/services/report.rb'), cursor(1, 2), {} as never, {} as never)).toEqual([])

    const erb = setup()
    expect(await erb.action.provideCodeActions(document(erb.content, PATH, 'erb'), cursor(2), {} as never, {} as never)).toEqual([])
  })
})

describe('multi-root: observations never cross project roots', () => {
  it('keeps an observation for one root invisible to a store bound to another root with the same relative path', async () => {
    const rootA = new ObservationStore()
    const rootB = new ObservationStore()
    await recordRefinement(rootA, PATH, CONTROLLER, CREATE, [rec('r1', CREATE)], [], steady)

    const fromA = setup({ store: rootA })
    const fromB = setup({ store: rootB })
    const [inA] = await fromA.lens.provideCodeLenses(document(CONTROLLER))
    const [inB] = await fromB.lens.provideCodeLenses(document(CONTROLLER))
    expect(inA.command?.command).toBe(REVIEW_AI_HINTS_COMMAND)
    expect(inB.command?.command).toBe(SUGGEST_REFACTORINGS_COMMAND)
  })

  it('shows nothing for a file in a folder the providers are not bound to', async () => {
    const { eng, observations, fingerprint, content } = setup()
    await recordRefinement(observations, PATH, content, CREATE, [rec('r1', CREATE)], [], steady)
    const otherFolder = new RefactoringCodeLensProvider({ engine: eng, observations, fingerprint, pathOf: () => undefined, enabled: () => true })
    expect(await otherFolder.provideCodeLenses(document(content))).toEqual([])
  })
})
