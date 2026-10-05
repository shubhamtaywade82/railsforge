import { describe, it, expect } from 'vitest'
import { PatternCatalogTreeProvider } from '../src/views/PatternCatalogTreeProvider'
import { PATTERN_CATALOG } from '../src/patterns/PatternCatalog'

const provider = (instances: Array<{ name: string; relativePath: string; line: number }> = []) =>
  new PatternCatalogTreeProvider({ getRoot: () => '/proj', loadInstances: () => instances })

describe('PatternCatalogTreeProvider', () => {
  it('shows the four categories, Rails patterns expanded', () => {
    const roots = provider().getChildren()
    expect(roots.map(r => r.label)).toEqual(['Rails Idiomatic Patterns', 'Behavioral Patterns', 'Structural Patterns', 'Creational Patterns'])
    expect(roots[0].collapsibleState).toBe(2)
  })

  it('every pattern opens the in-editor explanation — never an external URL', () => {
    const p = provider()
    const all = p.getChildren().flatMap(cat => p.getChildren(cat))
    expect(all).toHaveLength(PATTERN_CATALOG.length)
    for (const item of all) {
      expect(item.command?.command).toBe('railsforge.openPattern')
      expect(item.command?.arguments).toEqual([item.patternId])
      expect(JSON.stringify(item.command)).not.toMatch(/https?:/)
    }
  })

  it('only the service pattern offers Generate; project-backed patterns are expandable', () => {
    const p = provider()
    const all = p.getChildren().flatMap(cat => p.getChildren(cat))
    expect(all.filter(i => i.contextValue === 'pattern.generate').map(i => i.patternId)).toEqual(['service-object'])
    const service = all.find(i => i.patternId === 'service-object')!
    expect(service.collapsibleState).toBe(1)
    expect(all.find(i => i.patternId === 'strategy')!.collapsibleState).toBe(0)
  })

  it("expands a pattern to the project's classes, each opening its file at the class line", () => {
    const p = provider([{ name: 'Orders::Place', relativePath: 'app/services/orders/place.rb', line: 4 }])
    const service = p.getChildren().flatMap(c => p.getChildren(c)).find(i => i.patternId === 'service-object')!
    const [child] = p.getChildren(service)
    expect(child.label).toBe('Orders::Place')
    expect(child.description).toBe('app/services/orders/place.rb:4')
    expect(child.command?.command).toBe('vscode.open')
    const [uri, opts] = child.command!.arguments as [{ fsPath: string }, { selection: { startLine: number } }]
    expect(uri.fsPath.replace(/\\/g, '/')).toBe('/proj/app/services/orders/place.rb')
    expect(opts.selection.startLine).toBe(3)
  })

  it('shows an explanatory empty row when the project has none', () => {
    const p = provider([])
    const query = p.getChildren().flatMap(c => p.getChildren(c)).find(i => i.patternId === 'query-object')!
    const [row] = p.getChildren(query)
    expect(row.label).toBe('No query classes in this project')
    expect(row.command).toBeUndefined()
  })
})
