import { describe, it, expect, vi } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { TestCodeLensProvider } from '../src/testing/TestCodeLensProvider'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

describe('TestCodeLensProvider', () => {
  const provider = new TestCodeLensProvider()

  it('should return empty for non-test files', () => {
    const doc = new vscode.TextDocument('app/models/user.rb', 'ruby', 'class User; end')
    const lenses = provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(lenses).toEqual([])
  })

  it('should return lenses for RSpec test blocks', () => {
    const doc = new vscode.TextDocument('spec/models/user_spec.rb', 'ruby', `RSpec.describe User do
  it 'validates email' do
  end

  context 'when admin' do
    it 'can manage posts' do
    end
  end
end`)
    const lenses = provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(lenses.length).toBe(6) // 3 test blocks x 2 lenses each (it + it + context)
    expect(lenses[0].command?.title).toBe('▶ Run Test')
    expect(lenses[1].command?.title).toBe('🐞 Debug (rdbg)')
  })

  it('should return lenses for Minitest test blocks', () => {
    const doc = new vscode.TextDocument('test/models/user_test.rb', 'ruby', `class UserTest < ActiveSupport::TestCase
  test 'validates email' do
  end
end`)
    const lenses = provider.provideCodeLenses(doc as unknown as vscode.TextDocument)
    expect(lenses.length).toBe(2)
    expect(lenses[0].command?.command).toBe('railsforge.runSingleTest')
    expect(lenses[1].command?.command).toBe('railsforge.debugSingleTest')
  })
})
