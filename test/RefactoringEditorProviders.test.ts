import { describe, it, expect } from 'vitest'
import * as vscode from 'vscode'
import { RubyAstParser } from '../src/indexer/RubyAstParser'
import { RefactoringEngine } from '../src/refactoring-intelligence/core/RefactoringEngine'
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

/** Observations as the advisor would record them: here, the deterministic recommendations for the scope. */
function observe(store: ObservationStore, engine: RefactoringEngine, content: string, scope: ScopeRef): Recommendation[] {
  const recs = engine.recommendations(PATH, content, scope)
  recordRefinement(store, PATH, content, scope, recs)
  return recs
}

function setup(content = CONTROLLER) {
  const engine = new RefactoringEngine(new RubyAstParser())
  const observations = new ObservationStore()
  const lens = new RefactoringCodeLensProvider({ engine, observations, pathOf, enabled: () => true })
  const action = new RefactoringCodeActionProvider({ engine, resolver: new TargetResolver(), observations, pathOf })
  return { engine, observations, lens, action, content }
}

describe('RefactoringCodeLensProvider: rule-based lens (nothing observed yet)', () => {
  it('shows one lens above the method, linking to the command that asks the AI', () => {
    const doc = document(CONTROLLER)
    const [lens] = setup().lens.provideCodeLenses(doc)

    expect(lens.range.start.line).toBe(1)
    expect(lens.command).toMatchObject({ title: '✦ RailsForge: 1 refactoring opportunity · high', command: SUGGEST_REFACTORINGS_COMMAND })
    expect(lens.command?.arguments?.[0]).toBe(doc.uri)
  })

  it('shows nothing when the setting is off, for non-Ruby files, or outside the project', () => {
    const { engine, observations } = setup()
    const off = new RefactoringCodeLensProvider({ engine, observations, pathOf, enabled: () => false })
    expect(off.provideCodeLenses(document(CONTROLLER))).toEqual([])
    const on = new RefactoringCodeLensProvider({ engine, observations, pathOf, enabled: () => true })
    expect(on.provideCodeLenses(document(CONTROLLER, PATH, 'erb'))).toEqual([])
    const outside = new RefactoringCodeLensProvider({ engine, observations, pathOf: () => undefined, enabled: () => true })
    expect(outside.provideCodeLenses(document(CONTROLLER))).toEqual([])
  })

  it('hides low-confidence findings, so the editor stays quiet for weak signals', () => {
    const { lens } = setup(ENVY)
    expect(lens.provideCodeLenses(document(ENVY, 'app/services/report.rb'))).toEqual([])
  })
})

describe('RefactoringCodeLensProvider: AI hints observed for the scope', () => {
  it('replaces the rule lens with an observed-hints lens that reviews, without asking the AI', () => {
    const { lens, observations, engine, content } = setup()
    const observed = observe(observations, engine, content, CREATE)
    const [only] = lens.provideCodeLenses(document(content))

    expect(observed).toHaveLength(1)
    expect(only.command).toMatchObject({ title: '✦ AI: 1 hint observed · high', command: REVIEW_AI_HINTS_COMMAND })
  })

  it('says so when the AI reviewed the scope and recommended nothing there', () => {
    const { lens, observations, content } = setup()
    recordRefinement(observations, PATH, content, CREATE, [])
    const [only] = lens.provideCodeLenses(document(content))
    expect(only.command?.title).toBe('✦ AI reviewed: nothing to change at this level')
  })

  it('falls back to the rule lens once the scope text changes, so a stale hint is not shown', () => {
    const { lens, observations, engine, content } = setup()
    observe(observations, engine, content, CREATE)
    const edited = content.replace('InventoryService.new.reserve(@order)', 'Inventory.reserve(@order)')
    const [only] = lens.provideCodeLenses(document(edited))
    expect(only.command?.command).toBe(SUGGEST_REFACTORINGS_COMMAND)
  })

  it('keeps the observed hint when an edit happens outside the scope', () => {
    const { lens, observations, engine, content } = setup()
    observe(observations, engine, content, CREATE)
    const edited = `# a note above the class\n${content}`
    const [only] = lens.provideCodeLenses(document(edited))
    expect(only.command?.command).toBe(REVIEW_AI_HINTS_COMMAND)
  })

  it('asks VS Code for new lenses when an observation is recorded (the extension wires store to lens)', () => {
    const { lens, observations, content } = setup()
    let refreshed = 0
    lens.onDidChangeCodeLenses(() => { refreshed++ })
    observations.onDidChange(() => lens.refresh())
    recordRefinement(observations, PATH, content, CREATE, [])
    expect(refreshed).toBe(1)
  })
})

describe('RefactoringCodeActionProvider', () => {
  it('offers the rule-based lightbulb, with the count and the scope, and attaches the command with no edit', () => {
    const { action, content } = setup()
    const [item] = action.provideCodeActions(document(content), cursor(2, 4), {} as never, {} as never)

    expect(item.title).toBe('RailsForge: 1 refactoring suggestion for method OrdersController#create')
    expect(item.kind?.value).toBe(REFACTORING_ACTION_KIND.value)
    expect(item.command).toMatchObject({ command: SUGGEST_REFACTORINGS_COMMAND })
    expect(item.edit).toBeUndefined()
  })

  it('offers the observed hints instead, and only that: they are what the AI already said', () => {
    const { action, observations, engine, content } = setup()
    observe(observations, engine, content, CREATE)
    const items = action.provideCodeActions(document(content), cursor(2, 4), {} as never, {} as never)

    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('RailsForge: 1 AI hint observed for method OrdersController#create')
    expect(items[0].command).toMatchObject({ command: REVIEW_AI_HINTS_COMMAND })
  })

  it('offers nothing where the cursor is outside every scope', () => {
    const script = "puts 'hello'\n"
    const { action } = setup(script)
    expect(action.provideCodeActions(document(script, 'app/services/script.rb'), cursor(0), {} as never, {} as never)).toEqual([])
  })

  it('offers nothing for a low-confidence finding, and nothing for non-Ruby files', () => {
    const { action } = setup(ENVY)
    expect(action.provideCodeActions(document(ENVY, 'app/services/report.rb'), cursor(1, 2), {} as never, {} as never)).toEqual([])
    const { action: controller, content } = setup()
    expect(controller.provideCodeActions(document(content, PATH, 'erb'), cursor(2), {} as never, {} as never)).toEqual([])
  })
})
