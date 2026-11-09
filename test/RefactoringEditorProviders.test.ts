import { describe, it, expect } from 'vitest'
import * as vscode from 'vscode'
import { RubyAstParser } from '../src/indexer/RubyAstParser'
import { RefactoringEngine } from '../src/refactoring-intelligence/core/RefactoringEngine'
import { TargetResolver } from '../src/refactoring-intelligence/core/ScopeResolver'
import { relativeTo } from '../src/refactoring-intelligence/vscode/workspacePaths'
import { SUGGEST_REFACTORINGS_COMMAND } from '../src/refactoring-intelligence/vscode/RefactoringCommand'
import { RefactoringCodeLensProvider } from '../src/providers/RefactoringCodeLensProvider'
import { RefactoringCodeActionProvider, REFACTORING_ACTION_KIND } from '../src/providers/RefactoringCodeActionProvider'

const ROOT = '/proj'
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

const ENVY = ['class Report', '  def summary(order)', '    order.total + order.tax + order.discount + order.shipping', '  end', 'end', ''].join('\n')

function document(text: string, file = 'app/controllers/orders_controller.rb', languageId = 'ruby') {
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

const engine = () => new RefactoringEngine(new RubyAstParser())
const pathOf = (uri: vscode.Uri) => relativeTo(ROOT, uri.fsPath)

function lensProvider(options: { enabled?: boolean; eng?: RefactoringEngine } = {}) {
  return new RefactoringCodeLensProvider({ engine: options.eng ?? engine(), pathOf, enabled: () => options.enabled ?? true })
}

describe('RefactoringCodeLensProvider', () => {
  it('shows one lens above the method with a measured recommendation, linking to the advisor command', () => {
    const doc = document(CONTROLLER)
    const [lens] = lensProvider().provideCodeLenses(doc)

    expect(lens.range.start.line).toBe(1)
    expect(lens.command).toMatchObject({
      title: '✦ RailsForge: 1 refactoring opportunity · high',
      command: SUGGEST_REFACTORINGS_COMMAND,
    })
    expect(lens.command?.arguments?.[0]).toBe(doc.uri)
  })

  it('shows nothing when the setting is off', () => {
    expect(lensProvider({ enabled: false }).provideCodeLenses(document(CONTROLLER))).toEqual([])
  })

  it('shows nothing for files that are not Ruby, or outside the project', () => {
    expect(lensProvider().provideCodeLenses(document(CONTROLLER, 'app/controllers/orders_controller.rb', 'erb'))).toEqual([])
    const outside = new RefactoringCodeLensProvider({ engine: engine(), pathOf: () => undefined, enabled: () => true })
    expect(outside.provideCodeLenses(document(CONTROLLER))).toEqual([])
  })

  it('hides low-confidence findings, so the editor stays quiet for weak signals', () => {
    expect(lensProvider().provideCodeLenses(document(ENVY, 'app/services/report.rb'))).toEqual([])
  })
})

describe('RefactoringCodeActionProvider', () => {
  const provider = () => new RefactoringCodeActionProvider({ engine: engine(), resolver: new TargetResolver(), pathOf })

  it('offers the lightbulb with the count and the scope, and attaches the command with no edit', () => {
    const doc = document(CONTROLLER)
    const [action] = provider().provideCodeActions(doc, cursor(2, 4), {} as never, {} as never)

    expect(action.title).toBe('RailsForge: 1 refactoring suggestion for method OrdersController#create')
    expect(action.kind?.value).toBe(REFACTORING_ACTION_KIND.value)
    expect(action.command).toMatchObject({ command: SUGGEST_REFACTORINGS_COMMAND })
    expect(action.edit).toBeUndefined()
  })

  it('offers nothing where no scope has a recommendation', () => {
    // A file with no class, module or method: the resolver refuses the cursor, so nothing is offered.
    const script = "puts 'hello'\n"
    expect(provider().provideCodeActions(document(script, 'app/services/script.rb'), cursor(0), {} as never, {} as never)).toEqual([])
  })

  it('offers nothing for a low-confidence finding', () => {
    expect(provider().provideCodeActions(document(ENVY, 'app/services/report.rb'), cursor(1, 2), {} as never, {} as never)).toEqual([])
  })

  it('offers nothing for files that are not Ruby', () => {
    expect(provider().provideCodeActions(document(CONTROLLER, 'app/controllers/orders_controller.rb', 'erb'), cursor(2), {} as never, {} as never)).toEqual([])
  })
})
