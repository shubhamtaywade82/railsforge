import { describe, it, expect } from 'vitest'
import { needsEndKeyword, EndwiseProvider } from '../src/editing/EndwiseProvider'

describe('needsEndKeyword', () => {
  it('requires end for def/class/module/case/begin/for', () => {
    expect(needsEndKeyword('def foo')).toBe(true)
    expect(needsEndKeyword('  def foo(bar)')).toBe(true)
    expect(needsEndKeyword('class User < ApplicationRecord')).toBe(true)
    expect(needsEndKeyword('module Api')).toBe(true)
    expect(needsEndKeyword('case status')).toBe(true)
    expect(needsEndKeyword('begin')).toBe(true)
    expect(needsEndKeyword('for i in 1..10')).toBe(true)
  })

  it('requires end for leading if/unless/while/until but not statement modifiers', () => {
    expect(needsEndKeyword('if user.admin?')).toBe(true)
    expect(needsEndKeyword('unless user.present?')).toBe(true)
    expect(needsEndKeyword('while running')).toBe(true)
    expect(needsEndKeyword('until done')).toBe(true)
    expect(needsEndKeyword('return foo if bar')).toBe(false)
    expect(needsEndKeyword('destroy! unless persisted?')).toBe(false)
  })

  it('requires end for do blocks regardless of what precedes them', () => {
    expect(needsEndKeyword('items.each do |item|')).toBe(true)
    expect(needsEndKeyword('loop do')).toBe(true)
    expect(needsEndKeyword('result = items.map do |item|')).toBe(true)
  })

  it('requires end for if/case/begin used as an assigned/returned expression', () => {
    expect(needsEndKeyword('result = if condition')).toBe(true)
    expect(needsEndKeyword('x = case value')).toBe(true)
    expect(needsEndKeyword('return if enabled')).toBe(false)
  })

  it('does not require end when already closed on the same line', () => {
    expect(needsEndKeyword('def foo; end')).toBe(false)
    expect(needsEndKeyword('if x then y end')).toBe(false)
  })

  it('does not require end for block-continuation keywords', () => {
    expect(needsEndKeyword('else')).toBe(false)
    expect(needsEndKeyword('elsif other_condition')).toBe(false)
    expect(needsEndKeyword('when :active')).toBe(false)
    expect(needsEndKeyword('rescue StandardError => e')).toBe(false)
    expect(needsEndKeyword('ensure')).toBe(false)
  })

  it('does not require end for brace blocks, plain statements, comments, or blank lines', () => {
    expect(needsEndKeyword('items.each { |item| item.save }')).toBe(false)
    expect(needsEndKeyword('user.save!')).toBe(false)
    expect(needsEndKeyword('# a comment')).toBe(false)
    expect(needsEndKeyword('')).toBe(false)
    expect(needsEndKeyword('   ')).toBe(false)
  })
})

describe('EndwiseProvider', () => {
  it('returns an empty array for line 0', () => {
    const provider = new EndwiseProvider()
    const doc = { lineAt: () => ({ text: 'def foo', firstNonWhitespaceCharacterIndex: 0 }) }
    const result = provider.provideOnTypeFormattingEdits(doc as any, { line: 0, character: 0 })
    expect(result).toEqual([])
  })

  it('inserts an indented end after a line that needs it', () => {
    const provider = new EndwiseProvider()
    const doc = {
      lineAt: (lineNum: number) => ({
        text: '  def foo',
        firstNonWhitespaceCharacterIndex: 2,
      }),
    }
    const result = provider.provideOnTypeFormattingEdits(doc as any, { line: 1, character: 0 })
    expect(result).toHaveLength(1)
    expect(result[0].newText).toBe('\n  end')
  })

  it('returns empty array when previous line does not need end', () => {
    const provider = new EndwiseProvider()
    const doc = {
      lineAt: (lineNum: number) => ({
        text: '  user.save!',
        firstNonWhitespaceCharacterIndex: 2,
      }),
    }
    const result = provider.provideOnTypeFormattingEdits(doc as any, { line: 1, character: 0 })
    expect(result).toEqual([])
  })
})

