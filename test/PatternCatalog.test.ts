import { spawnSync } from 'child_process'
import { describe, it, expect } from 'vitest'
import {
  CATEGORY_ORDER, PATTERN_CATALOG, explainPatternPrompt, getCatalogPattern, patternsInCategory, renderPatternDoc, toProjectInstances,
} from '../src/patterns/PatternCatalog'
import { IndexedPattern } from '../src/patterns/ProjectPatternIndexer'
import { parsePatternDocId, patternDocPath } from '../src/views/VirtualDocs'

const hasRuby = spawnSync('ruby', ['-v']).status === 0

describe('PatternCatalog content', () => {
  it('has unique kebab-case ids and complete entries', () => {
    const ids = PATTERN_CATALOG.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PATTERN_CATALOG) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/)
      expect(p.name.length).toBeGreaterThan(2)
      expect(p.summary.length).toBeGreaterThan(5)
      expect(p.intent.length).toBeGreaterThan(40)
      expect(p.whenToUse.length).toBeGreaterThan(0)
      expect(p.watchOutFor.length).toBeGreaterThan(0)
      expect(p.example.trim().length).toBeGreaterThan(20)
    }
  })

  it('every related id resolves and every category has entries', () => {
    for (const p of PATTERN_CATALOG) {
      for (const rel of p.related ?? []) {expect(getCatalogPattern(rel), `${p.id} -> ${rel}`).toBeDefined()}
    }
    for (const c of CATEGORY_ORDER) {expect(patternsInCategory(c).length).toBeGreaterThan(0)}
  })

  it('references only refactoring.guru https links (never copied text)', () => {
    for (const p of PATTERN_CATALOG) {
      if (p.reference) {expect(p.reference.url).toMatch(/^https:\/\/refactoring\.guru\/(design-patterns|smells)\/[a-z-]+$/)}
    }
  })

  it.skipIf(!hasRuby)('every example is syntactically valid Ruby (ruby -c)', () => {
    for (const p of PATTERN_CATALOG) {
      const res = spawnSync('ruby', ['-c'], { input: p.example, encoding: 'utf8' })
      expect(res.status, `${p.id}: ${res.stderr}`).toBe(0)
    }
  })
})

describe('renderPatternDoc', () => {
  it('lists the project instances with relative paths and lines', () => {
    const indexed: IndexedPattern[] = [
      { id: 'a', type: 'service', name: 'Orders::Place', filePath: '/p/app/services/orders/place.rb', lineStart: 3, publicMethods: [], preview: '' },
      { id: 'b', type: 'service', name: 'Billing::Charge', filePath: '/p/app/services/billing/charge.rb', lineStart: 1, publicMethods: [], preview: '' },
    ]
    const doc = renderPatternDoc(getCatalogPattern('service-object')!, toProjectInstances(indexed, '/p'))
    expect(doc).toContain('# Service Object')
    expect(doc).toContain('## In this project')
    expect(doc).toContain('`Billing::Charge` — app/services/billing/charge.rb:1')
    const section = doc.slice(doc.indexOf('## In this project'))
    expect(section.indexOf('Billing::Charge')).toBeLessThan(section.indexOf('Orders::Place'))
    expect(doc).toContain('```ruby')
    expect(doc).not.toContain('/p/app')
  })

  it('says so when the project has none, and omits the section for patterns without a project kind', () => {
    expect(renderPatternDoc(getCatalogPattern('query-object')!, [])).toContain('No query classes found')
    expect(renderPatternDoc(getCatalogPattern('strategy')!, undefined)).not.toContain('In this project')
  })

  it('normalizes Windows paths', () => {
    const out = toProjectInstances([
      { id: 'a', type: 'form', name: 'F', filePath: 'C:\\p\\app\\forms\\f.rb', lineStart: 2, publicMethods: [], preview: '' },
    ], 'C:\\p')
    expect(out[0].relativePath).toBe('app/forms/f.rb')
  })
})

describe('explainPatternPrompt', () => {
  it('is built from catalog text only', () => {
    const p = getCatalogPattern('service-object')!
    const prompt = explainPatternPrompt(p)
    expect(prompt).toContain(p.intent)
    expect(prompt).toContain(p.example)
    expect(prompt).not.toMatch(/schema|routes\.rb|\/home\/|workspace/i)
  })
})

describe('pattern virtual doc path', () => {
  it('round-trips ids', () => {
    expect(parsePatternDocId(patternDocPath('factory-method'))).toBe('factory-method')
    expect(parsePatternDocId('/pattern/../etc.md')).toBeUndefined()
    expect(parsePatternDocId('/routes.md')).toBeUndefined()
  })
})
