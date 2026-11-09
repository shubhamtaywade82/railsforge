import { describe, it, expect } from 'vitest'
import { extractJsonObject, parseAdvice, parseCodeDiff } from '../src/refactor/advisor/ResponseParsers'

const validSuggestion = {
  title: 'Extract PaymentGateway behind a Strategy',
  pattern: 'Strategy',
  principle: 'OCP',
  impact: 'medium',
  rationale: 'Order#charge branches on the provider name, so every new provider edits Order.',
  files: ['app/models/order.rb', 'app/services/payment_gateway.rb'],
  steps: ['Create PaymentGateway', 'Delegate from Order'],
}

describe('extractJsonObject', () => {
  it('reads a bare JSON object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })

  it('reads a fenced JSON block surrounded by prose', () => {
    const text = 'Here you go:\n```json\n{"suggestions": []}\n```\nHope it helps.'
    expect(extractJsonObject(text)).toEqual({ ok: true, value: { suggestions: [] } })
  })

  it('reports an answer with no object at all', () => {
    expect(extractJsonObject('I refuse.')).toEqual({ ok: false, message: 'The answer contained no JSON object.' })
  })

  it('reports malformed JSON without throwing', () => {
    const result = extractJsonObject('{"suggestions": [}')
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toContain('not valid JSON')
  })
})

describe('parseAdvice', () => {
  it('accepts a well-formed answer and normalises optional fields', () => {
    const result = parseAdvice(JSON.stringify({ suggestions: [validSuggestion] }))
    expect(result).toEqual({
      ok: true,
      value: [{
        title: 'Extract PaymentGateway behind a Strategy',
        pattern: 'Strategy',
        principle: 'OCP',
        impact: 'medium',
        rationale: 'Order#charge branches on the provider name, so every new provider edits Order.',
        files: ['app/models/order.rb', 'app/services/payment_gateway.rb'],
        steps: ['Create PaymentGateway', 'Delegate from Order'],
      }],
    })
  })

  it('accepts an empty list: the target is already well designed', () => {
    expect(parseAdvice('{"suggestions": []}')).toEqual({ ok: true, value: [] })
  })

  it('lowercases impact and falls back to medium for unknown values', () => {
    const upper = parseAdvice(JSON.stringify({ suggestions: [{ ...validSuggestion, impact: 'HIGH' }] }))
    expect(upper.ok && upper.value[0].impact).toBe('high')
    const unknown = parseAdvice(JSON.stringify({ suggestions: [{ ...validSuggestion, impact: 'catastrophic' }] }))
    expect(unknown.ok && unknown.value[0].impact).toBe('medium')
  })

  it('drops an empty principle rather than keeping a blank string', () => {
    const result = parseAdvice(JSON.stringify({ suggestions: [{ ...validSuggestion, principle: '  ' }] }))
    expect(result.ok && result.value[0].principle).toBeUndefined()
  })

  it('rejects a suggestion with no files and names the field', () => {
    const result = parseAdvice(JSON.stringify({ suggestions: [{ ...validSuggestion, files: [] }] }))
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toContain('files')
  })

  it('rejects a rationale too short to cite anything', () => {
    const result = parseAdvice(JSON.stringify({ suggestions: [{ ...validSuggestion, rationale: 'ok' }] }))
    expect(result.ok).toBe(false)
  })

  it('rejects an answer missing the suggestions key', () => {
    const result = parseAdvice('{"items": []}')
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toContain('required shape')
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
    const hunks = parseCodeDiff(diff)
    expect(hunks).toEqual([{
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
    const hunks = parseCodeDiff(withBlank)
    expect(hunks?.[0].oldLines).toEqual(['class Order', '', '  def a; end'])
  })

  it('returns null when the answer has no hunk at all', () => {
    expect(parseCodeDiff('Sorry, I cannot do that.')).toBeNull()
  })

  it('returns null when prose sits inside a hunk', () => {
    const broken = ['+++ b/app/models/order.rb', '@@ -1,1 +1,1 @@', '-x', '+y', 'Hope this helps!'].join('\n')
    expect(parseCodeDiff(broken)).toBeNull()
  })
})
