import { describe, it, expect } from 'vitest'
import { SchemaIndexer } from '../src/rails/SchemaIndexer'
import { RoutesIndexer } from '../src/rails/RoutesIndexer'
import { parseVirtualDocKind, renderRoutesDoc, renderRuntimeDoc, renderSchemaDoc, renderToolchainDoc, virtualDocPath } from '../src/views/VirtualDocs'

describe('VirtualDocs', () => {
  it('renders routes as a markdown table', () => {
    const routes = new RoutesIndexer()
    routes.parseRoutesDsl('Rails.application.routes.draw do\n  resources :posts, only: %i[index show]\nend\n')
    const doc = renderRoutesDoc(routes.getAllRoutes())
    expect(doc).toContain('| Verb | Path | Action | Helper |')
    expect(doc).toContain('posts#index')
    expect(renderRoutesDoc([])).toContain('No routes indexed')
  })

  it('renders schema tables with columns, nullability and keys', () => {
    const schema = new SchemaIndexer()
    schema.parseSchema('ActiveRecord::Schema.define do\n  create_table "users" do |t|\n    t.string "email", null: false\n    t.integer "age"\n  end\nend\n')
    const doc = renderSchemaDoc(schema.getAllTables())
    expect(doc).toContain('## users')
    expect(doc).toContain('| email | string | NOT NULL |')
    expect(doc).toContain('| age | integer | yes |')
    expect(renderSchemaDoc([])).toContain('No tables indexed')
  })

  it('renders runtime and toolchain docs', () => {
    expect(renderRuntimeDoc(undefined)).toContain('No snapshot yet')
    const doc = renderToolchainDoc({ root: '/p', rubyVersion: '3.3.0', railsVersion: '7.1', versionManager: 'mise', launcher: 'bin/ stubs', testFramework: 'rspec', projectType: 'monolith' })
    expect(doc).toContain('Version manager: mise')
    expect(doc).toContain('Ruby: 3.3.0')
  })

  it('round-trips document kinds through the URI path', () => {
    for (const kind of ['routes', 'schema', 'runtime', 'toolchain'] as const) {
      expect(parseVirtualDocKind(virtualDocPath(kind))).toBe(kind)
    }
    expect(parseVirtualDocKind('/other.md')).toBeUndefined()
  })
})
