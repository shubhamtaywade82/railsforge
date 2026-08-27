import { describe, it, expect, vi } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { ErbTagCompletionProvider } from '../src/editing/ErbTagCompletionProvider'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

describe('ErbTagCompletionProvider', () => {
  const provider = new ErbTagCompletionProvider()

  it('should return undefined when line does not end with <%', () => {
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<div class="foo">')
    const result = provider.provideCompletionItems(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 15),
    )
    expect(result).toBeUndefined()
  })

  it('should return completions when line ends with <%', () => {
    const doc = new vscode.TextDocument('test.html.erb', 'erb', '<%')
    const result = provider.provideCompletionItems(
      doc as unknown as vscode.TextDocument,
      new vscode.Position(0, 2),
    )
    expect(result).toBeDefined()
    expect(result!.length).toBe(3)
    expect(result![0].label).toContain('output')
    expect(result![1].label).toContain('execution')
    expect(result![2].label).toContain('comment')
  })
})
