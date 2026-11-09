import { describe, it, expect } from 'vitest'
import { extractJsonObject, parseCodeDiff, parseRefinement } from '../src/refactoring-intelligence/core/ResponseParsers'

const recommendation = {
  candidateId: 'c1',
  decision: 'recommend',
  technique: 'strategy',
  design: 'One strategy object per payment type.',
  benefit: 'Adding a payment type adds a class.',
  risk: 'Selection logic must cover the default.',
  alternatives: [{ name: 'Hash lookup', whenBetter: 'branches only map values' }],
  affectedFiles: ['app/services/checkout.rb'],
  steps: ['List the values', 'Create one class per value'],
  verification: ['Spec every value and the default'],
}

describe('extractJsonObject', () => {
  it('reads a bare JSON object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })

  it('reads a fenced JSON block surrounded by prose', () => {
    const text = 'Here you go:\n```json\n{"decisions": []}\n```\nHope it helps.'
    expect(extractJsonObject(text)).toEqual({ ok: true, value: { decisions: [] } })
  })

  it('reports an answer with no object at all', () => {
    expect(extractJsonObject('I refuse.')).toEqual({ ok: false, message: 'The answer contained no JSON object.' })
  })

  it('reports malformed JSON without throwing', () => {
    const result = extractJsonObject('{"decisions": [}')
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toContain('not valid JSON')
  })
})

describe('parseRefinement', () => {
  it('accepts a recommend decision and keeps its fields', () => {
    const result = parseRefinement(JSON.stringify({ decisions: [recommendation] }))
    expect(result).toEqual({
      ok: true,
      value: [{
        candidateId: 'c1',
        decision: 'recommend',
        technique: 'strategy',
        reason: undefined,
        design: 'One strategy object per payment type.',
        benefit: 'Adding a payment type adds a class.',
        risk: 'Selection logic must cover the default.',
        alternatives: [{ name: 'Hash lookup', whenBetter: 'branches only map values' }],
        affectedFiles: ['app/services/checkout.rb'],
        steps: ['List the values', 'Create one class per value'],
        verification: ['Spec every value and the default'],
      }],
    })
  })

  it('accepts a skip decision with its reason', () => {
    const result = parseRefinement('{"decisions":[{"candidateId":"c2","decision":"skip","reason":"one stable collaborator"}]}')
    expect(result.ok && result.value[0]).toMatchObject({ candidateId: 'c2', decision: 'skip', reason: 'one stable collaborator' })
  })

  it('reads decision casing leniently, and treats anything other than skip as recommend', () => {
    const skip = parseRefinement('{"decisions":[{"candidateId":"c1","decision":"Skip"}]}')
    expect(skip.ok && skip.value[0].decision).toBe('skip')
    const unknown = parseRefinement('{"decisions":[{"candidateId":"c1","decision":"maybe"}]}')
    expect(unknown.ok && unknown.value[0].decision).toBe('recommend')
  })

  it('fills missing optional lists with empty arrays', () => {
    const result = parseRefinement('{"decisions":[{"candidateId":"c1","decision":"recommend","technique":"extract-method"}]}')
    expect(result.ok && result.value[0]).toMatchObject({ affectedFiles: [], steps: [], verification: [], alternatives: [] })
  })

  it('rejects a decision with no candidate id, and names the field', () => {
    const result = parseRefinement('{"decisions":[{"decision":"recommend"}]}')
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toContain('candidateId')
  })

  it('rejects an answer without a decisions list', () => {
    const result = parseRefinement('{"suggestions": []}')
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toContain('required shape')
  })

  it('accepts an empty decisions list at parse time (the advisor decides whether that is acceptable)', () => {
    expect(parseRefinement('{"decisions": []}')).toEqual({ ok: true, value: [] })
  })
})

describe('parseCodeDiff', () => {
  const diff = [
    '--- a/app/models/order.rb',
    '+++ b/app/models/order.rb',
    '@@ -1,3 +1,3 @@',
    ' class Order',
    '-  def total; 1; end',
    '+  def total = 1',
    ' end',
  ].join('\n')

  it('parses a bare diff into hunks tagged with their file', () => {
    expect(parseCodeDiff(diff)).toEqual([{
      file: 'app/models/order.rb',
      oldStart: 0,
      oldLines: ['class Order', '  def total; 1; end', 'end'],
      newLines: ['class Order', '  def total = 1', 'end'],
    }])
  })

  it('prefers a fenced diff block over surrounding prose', () => {
    const answer = `Sure, here is the change:\n\`\`\`diff\n${diff}\n\`\`\`\nLet me know!`
    expect(parseCodeDiff(answer)?.[0].file).toBe('app/models/order.rb')
  })

  it('reads a blank line inside a hunk as an empty context line', () => {
    const withBlank = [
      '+++ b/app/models/order.rb',
      '@@ -1,3 +1,3 @@',
      ' class Order',
      '',
      '-  def a; end',
      '+  def a = nil',
    ].join('\n')
    expect(parseCodeDiff(withBlank)?.[0].oldLines).toEqual(['class Order', '', '  def a; end'])
  })

  it('returns null when the answer has no hunk at all', () => {
    expect(parseCodeDiff('Sorry, I cannot do that.')).toBeNull()
  })

  it('returns null when prose sits inside a hunk', () => {
    const broken = ['+++ b/app/models/order.rb', '@@ -1,1 +1,1 @@', '-x', '+y', 'Hope this helps!'].join('\n')
    expect(parseCodeDiff(broken)).toBeNull()
  })
})
