import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { RBSDefinitionProvider, findEnclosingClass } from '../src/types/RBSDefinitionProvider'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

describe('findEnclosingClass', () => {
  it('finds the immediate enclosing class for a 2-space-indented method', () => {
    const lines = [
      'class Greeter',
      '  attr_reader :name',
      '',
    ]
    expect(findEnclosingClass(lines, 2)).toBe('Greeter')
  })

  it('finds the innermost class when nested inside a module', () => {
    const lines = [
      'module App',
      '  class Greeter',
      '    attr_reader :name',
      '',
    ]
    expect(findEnclosingClass(lines, 4)).toBe('Greeter')
  })

  it('skips blank lines while scanning upward', () => {
    const lines = [
      'class Greeter',
      '',
      '  ',
      '',
    ]
    expect(findEnclosingClass(lines, 2)).toBe('Greeter')
  })

  it('returns null when there is no enclosing class/module', () => {
    expect(findEnclosingClass(['# a comment', ''], 0)).toBeNull()
  })

  it('does not cross out of a sibling class defined earlier at the same file', () => {
    const lines = [
      'class First',
      '  def foo; end',
      'end',
      '',
      'class Second',
      '',
    ]
    expect(findEnclosingClass(lines, 2)).toBe('Second')
  })
})

describe('RBSDefinitionProvider', () => {
  const index = {
    isEmpty: false,
    lookupExact: vi.fn().mockReturnValue(null),
  } as unknown as import('../src/types/RBSIndex').RBSIndex

  let provider: RBSDefinitionProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new RBSDefinitionProvider(index)
  })

  it('should return null when index is empty', () => {
    const emptyIndex = {
      isEmpty: true,
      lookupExact: vi.fn(),
    } as unknown as import('../src/types/RBSIndex').RBSIndex
    const emptyProvider = new RBSDefinitionProvider(emptyIndex)
    const doc = new vscode.TextDocument('test.rb', 'ruby', '  def save; end')
    const result = emptyProvider.provideDefinition(doc as unknown as vscode.TextDocument, new vscode.Position(1, 6))
    expect(result).toBeNull()
  })

  it('should return null when line is not a def line', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'class Foo\n  attr_reader :name\nend')
    const result = provider.provideDefinition(doc as unknown as vscode.TextDocument, new vscode.Position(1, 2))
    expect(result).toBeNull()
  })

  it('should return null when cursor is not on the method name', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'class Foo\n  def save\n  end\nend')
    const result = provider.provideDefinition(doc as unknown as vscode.TextDocument, new vscode.Position(1, 2))
    expect(result).toBeNull()
  })

  it('should return null when no enclosing class found', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', '  def save\n  end')
    const result = provider.provideDefinition(doc as unknown as vscode.TextDocument, new vscode.Position(0, 6))
    expect(result).toBeNull()
  })

  it('should return null when RBS index has no matching method', () => {
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'class Foo\n  def save\n  end\nend')
    const result = provider.provideDefinition(doc as unknown as vscode.TextDocument, new vscode.Position(1, 6))
    expect(result).toBeNull()
  })

  it('should return location when RBS signature is found', () => {
    vi.mocked(index.lookupExact).mockReturnValue({
      className: 'Foo',
      methodName: 'save',
      isSelf: false,
      signature: '() -> void',
      filePath: '/workspace/sig/foo.rbs',
      line: 5,
    })
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'class Foo\n  def save\n  end\nend')
    const result = provider.provideDefinition(doc as unknown as vscode.TextDocument, new vscode.Position(1, 6))
    expect(result).not.toBeNull()
  })

  it('should handle self.method definitions', () => {
    vi.mocked(index.lookupExact).mockReturnValue({
      className: 'Foo',
      methodName: 'default',
      isSelf: true,
      signature: '() -> Foo',
      filePath: '/workspace/sig/foo.rbs',
      line: 10,
    })
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'class Foo\n  def self.default\n  end\nend')
    const result = provider.provideDefinition(doc as unknown as vscode.TextDocument, new vscode.Position(1, 14))
    expect(result).not.toBeNull()
  })

  it('should handle method names with ? and !', () => {
    vi.mocked(index.lookupExact).mockReturnValue({
      className: 'Foo',
      methodName: 'valid?',
      isSelf: false,
      signature: '() -> bool',
      filePath: '/workspace/sig/foo.rbs',
      line: 3,
    })
    const doc = new vscode.TextDocument('test.rb', 'ruby', 'class Foo\n  def valid?\n  end\nend')
    const result = provider.provideDefinition(doc as unknown as vscode.TextDocument, new vscode.Position(1, 6))
    expect(result).not.toBeNull()
  })
})
