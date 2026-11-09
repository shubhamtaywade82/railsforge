import { describe, it, expect } from 'vitest'
import { TargetResolver, describeTarget } from '../src/refactoring-intelligence/core/ScopeResolver'
import { ADVISOR_LIMITS } from '../src/refactoring-intelligence/core/types'
import { RubyAstParser } from '../src/indexer/RubyAstParser'

const ORDER = [
  'class Order < ApplicationRecord', // 1
  '  def total', // 2
  '    items.sum(&:price) * 1.2', // 3
  '  end', // 4
  '', // 5
  '  def tax', // 6
  '    total * 0.2', // 7
  '  end', // 8
  'end', // 9
].join('\n')

const cursor = (line: number) => ({ startLine: line, endLine: line, isEmpty: true })
const select = (startLine: number, endLine: number) => ({ startLine, endLine, isEmpty: false })

describe('TargetResolver', () => {
  it('resolves a cursor inside a method to that method, with its owning class', () => {
    const result = new TargetResolver().resolve(ORDER, cursor(3))
    expect(result).toEqual({
      ok: true,
      target: {
        kind: 'method',
        name: 'total',
        className: 'Order',
        startLine: 2,
        endLine: 4,
        text: '  def total\n    items.sum(&:price) * 1.2\n  end',
      },
    })
  })

  it('resolves a cursor between methods to the enclosing class', () => {
    const result = new TargetResolver().resolve(ORDER, cursor(5))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.target.kind).toBe('class')
      expect(result.target).toMatchObject({ name: 'Order', startLine: 1, endLine: 9 })
    }
  })

  it('picks the innermost method when classes are nested', () => {
    const nested = [
      'class Outer', // 1
      '  class Inner', // 2
      '    def run', // 3
      '      work', // 4
      '    end', // 5
      '  end', // 6
      '  def helper', // 7
      '    1', // 8
      '  end', // 9
      'end', // 10
    ].join('\n')
    const resolver = new TargetResolver()
    expect(resolver.resolve(nested, cursor(4))).toMatchObject({ ok: true, target: { kind: 'method', name: 'run', className: 'Inner' } })
    expect(resolver.resolve(nested, cursor(8))).toMatchObject({ ok: true, target: { kind: 'method', name: 'helper', className: 'Outer' } })
  })

  it('resolves methods inside modules (concerns), which the class-only parser would miss', () => {
    const concern = ['module Payable', '  def pay', '    charge', '  end', 'end'].join('\n')
    expect(new TargetResolver().resolve(concern, cursor(3))).toMatchObject({
      ok: true,
      target: { kind: 'method', name: 'pay', className: 'Payable' },
    })
  })

  it('turns a non-empty selection into a block, with its enclosing method and class', () => {
    const result = new TargetResolver().resolve(ORDER, select(3, 3))
    expect(result).toEqual({
      ok: true,
      target: {
        kind: 'block',
        name: 'lines 3-3',
        startLine: 3,
        endLine: 3,
        text: '    items.sum(&:price) * 1.2',
        enclosingClass: 'Order',
        enclosingMethod: 'total',
      },
    })
  })

  it('treats a reversed selection as the same block', () => {
    const forward = new TargetResolver().resolve(ORDER, select(6, 7))
    const reversed = new TargetResolver().resolve(ORDER, select(7, 6))
    expect(reversed).toEqual(forward)
  })

  it('refuses a blank selection rather than analysing nothing', () => {
    const spaced = 'class A\n  \n  \nend'
    const result = new TargetResolver().resolve(spaced, select(2, 3))
    expect(result).toEqual({ ok: false, message: expect.stringContaining('blank') })
  })

  it('refuses a cursor outside any class, module or method instead of guessing a scope', () => {
    const script = "puts 'hello'\nputs 'world'"
    const result = new TargetResolver().resolve(script, cursor(1))
    expect(result).toEqual({ ok: false, message: expect.stringContaining('Put the cursor inside a class') })
  })

  it('refuses a method larger than the target limit and names it', () => {
    const body = Array.from({ length: 600 }, (_, i) => `    value_${i} = ${i} + compute_${i}_with_a_long_name`).join('\n')
    const huge = ['class Big', '  def monster', body, '  end', 'end'].join('\n')
    const result = new TargetResolver().resolve(huge, cursor(10))
    expect(huge.length).toBeGreaterThan(ADVISOR_LIMITS.targetMaxChars)
    expect(result).toEqual({ ok: false, message: expect.stringContaining('Method monster is') })
  })

  it('refuses an oversized selection', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `    call_${i}(argument_number_${i})`)
    const content = ['class C', '  def m', ...lines, '  end', 'end'].join('\n')
    const result = new TargetResolver().resolve(content, select(3, 402))
    expect(result).toEqual({ ok: false, message: expect.stringContaining('The selection is') })
  })

  it('clamps a selection that runs past the end of the file', () => {
    const result = new TargetResolver().resolve(ORDER, select(8, 99))
    expect(result).toMatchObject({ ok: true, target: { kind: 'block', startLine: 8, endLine: 9 } })
  })

  it('keeps line numbers correct for CRLF files', () => {
    const crlf = ORDER.replace(/\n/g, '\r\n')
    expect(new TargetResolver().resolve(crlf, cursor(3))).toMatchObject({
      ok: true,
      target: { kind: 'method', name: 'total', startLine: 2, endLine: 4 },
    })
  })

  it('re-parses when the content changes (the cache is keyed by content, not by identity)', () => {
    const resolver = new TargetResolver()
    expect(resolver.resolve(ORDER, cursor(3))).toMatchObject({ ok: true, target: { name: 'total' } })
    const renamed = ORDER.replace('def total', 'def gross_total')
    expect(resolver.resolve(renamed, cursor(3))).toMatchObject({ ok: true, target: { name: 'gross_total' } })
  })
})

describe('RubyAstParser.parseTypeDefinitions', () => {
  it('returns classes and modules, tagged by kind', () => {
    const types = new RubyAstParser().parseTypeDefinitions(['class A', 'end', 'module B', 'end'].join('\n'))
    expect(types.map(t => [t.name, t.kind])).toEqual([['A', 'class'], ['B', 'module']])
  })

  it('leaves parseClasses unchanged: it still returns classes only', () => {
    const parser = new RubyAstParser()
    const source = ['class A', 'end', 'module B', 'end'].join('\n')
    expect(parser.parseClasses(source).map(c => c.name)).toEqual(['A'])
  })
})

describe('describeTarget', () => {
  it('labels each target kind for UI text', () => {
    expect(describeTarget({ kind: 'class', name: 'Order', startLine: 1, endLine: 9, text: '' })).toBe('class Order')
    expect(describeTarget({ kind: 'method', name: 'total', className: 'Order', startLine: 2, endLine: 4, text: '' })).toBe('method Order#total')
    expect(describeTarget({ kind: 'block', startLine: 3, endLine: 5, text: '' })).toBe('lines 3-5')
  })
})
