import { describe, it, expect } from 'vitest'
import * as vscode from 'vscode'
import {
  RefactorSuggestionCodeActionProvider,
  REFACTOR_ADVISOR_KIND,
  SUGGEST_REFACTORINGS_COMMAND,
} from '../src/refactor/advisor/RefactorAdvisorCommand'
import { TargetResolver } from '../src/refactor/advisor/TargetResolver'

const SOURCE = [
  'class Order', // 1
  '  def total', // 2
  '    items.sum(&:price)', // 3
  '  end', // 4
  'end', // 5
].join('\n')

function document(text: string, languageId = 'ruby') {
  return {
    languageId,
    uri: { fsPath: '/proj/app/models/order.rb', scheme: 'file' },
    getText: () => text,
  } as unknown as vscode.TextDocument
}

/** Zero-based positions, as VS Code passes them. */
function range(startLine: number, endLine: number, startChar = 0, endChar = 0): vscode.Range {
  const isEmpty = startLine === endLine && startChar === endChar
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
    isEmpty,
  } as unknown as vscode.Range
}

const provider = () => new RefactorSuggestionCodeActionProvider(new TargetResolver())

describe('RefactorSuggestionCodeActionProvider', () => {
  it('offers one command-backed action for the method under the cursor, with no edit attached', () => {
    const doc = document(SOURCE)
    const cursorInMethod = range(2, 2, 4, 4)
    const actions = provider().provideCodeActions(doc, cursorInMethod, {} as never, {} as never)

    expect(actions).toHaveLength(1)
    const [action] = actions
    expect(action.title).toBe('RailsForge: suggest refactorings for method Order#total')
    expect(action.command).toEqual({
      command: SUGGEST_REFACTORINGS_COMMAND,
      title: 'Suggest refactorings for method Order#total',
      arguments: [doc.uri, cursorInMethod],
    })
    expect(action.edit).toBeUndefined()
  })

  it('uses the Refactor kind so it appears under the Refactor menu and the lightbulb', () => {
    expect(REFACTOR_ADVISOR_KIND.value).toBe('Refactor.railsforge.advisor')
    const [action] = provider().provideCodeActions(document(SOURCE), range(2, 2, 4, 4), {} as never, {} as never)
    expect(action.kind).toBe(REFACTOR_ADVISOR_KIND)
  })

  it('offers a class-level action on the class body outside any method', () => {
    // Zero-based line 4 is the class's closing `end` (1-based line 5).
    const [action] = provider().provideCodeActions(document(SOURCE), range(4, 4), {} as never, {} as never)
    expect(action.title).toContain('class Order')
  })

  it('offers a block action for a non-empty selection', () => {
    // Zero-based line 2 is 1-based line 3; characters 0..10 select part of it.
    const [action] = provider().provideCodeActions(document(SOURCE), range(2, 2, 0, 10), {} as never, {} as never)
    expect(action.title).toContain('lines 3-3')
  })

  it('offers nothing outside a class, module or method', () => {
    const script = "puts 'hello'"
    expect(provider().provideCodeActions(document(script), range(0, 0), {} as never, {} as never)).toEqual([])
  })

  it('offers nothing for files that are not Ruby', () => {
    expect(provider().provideCodeActions(document(SOURCE, 'erb'), range(2, 2, 4), {} as never, {} as never)).toEqual([])
  })
})
