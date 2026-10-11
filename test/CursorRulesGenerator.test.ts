import { describe, it, expect } from 'vitest'
import { buildCursorRulesContent, buildSystemPromptMarkdown } from '../src/mcp/CursorRulesGenerator'
import { SchemaTable } from '../src/rails/SchemaIndexer'
import { RailsRoute } from '../src/rails/RoutesIndexer'
import { IndexedPattern } from '../src/patterns/ProjectPatternIndexer'

describe('buildCursorRulesContent', () => {
  const table: SchemaTable = {
    name: 'users',
    columns: new Map([['email', { name: 'email', type: 'string', nullable: false }]]),
    indexes: [],
    foreignKeys: [],
  }
  const route: RailsRoute = { verb: 'GET', uriPattern: '/users', controller: 'users', action: 'index' }
  const pattern: IndexedPattern = {
    id: '1', type: 'service', name: 'CreateOrderService', filePath: '/repo/app/services/create_order_service.rb',
    lineStart: 1, publicMethods: ['call'], preview: '',
  }

  it('states the Rails version constraint for a Rails project', () => {
    const content = buildCursorRulesContent({
      rubyVersion: '3.3.0', railsVersion: '7.1.0', hasRails: true,
      tables: [], routes: [], patterns: [], mcpServerAvailable: false,
    })
    expect(content).toContain('This is a Rails 7.1.0 project on Ruby 3.3.0')
  })

  it('states the standalone-Ruby constraint for a non-Rails project', () => {
    const content = buildCursorRulesContent({
      rubyVersion: '3.3.0', hasRails: false,
      tables: [], routes: [], patterns: [], mcpServerAvailable: false,
    })
    expect(content).toContain('This is a standalone Ruby project (not Rails)')
    expect(content).not.toContain('This is a Rails')
  })

  it('includes schema, routes, and patterns sections when data is present', () => {
    const content = buildCursorRulesContent({
      rubyVersion: '3.3.0', railsVersion: '7.1.0', hasRails: true,
      tables: [table], routes: [route], patterns: [pattern], mcpServerAvailable: true,
    })

    expect(content).toContain('`users`: email:string')
    expect(content).toContain('GET `/users` → `users#index`')
    expect(content).toContain('**service**: CreateOrderService')
    expect(content).toContain('railsforge` MCP server is available')
  })

  it('notes API-only constraints when projectType is api_only', () => {
    const content = buildCursorRulesContent({
      rubyVersion: '3.3.0', railsVersion: '7.1.0', hasRails: true, projectType: 'api_only',
      tables: [], routes: [], patterns: [], mcpServerAvailable: false,
    })
    expect(content).toContain('API-only Rails app')
    expect(content).toContain('do not suggest ERB/HAML/Slim views')
  })

  it('notes gem constraints when projectType is gem', () => {
    const content = buildCursorRulesContent({
      rubyVersion: '3.3.0', hasRails: false, projectType: 'gem',
      tables: [], routes: [], patterns: [], mcpServerAvailable: false,
    })
    expect(content).toContain('This is a Ruby gem, not a Rails application')
  })

  it('adds no extra note for monolith or script project types', () => {
    const monolith = buildCursorRulesContent({
      rubyVersion: '3.3.0', railsVersion: '7.1.0', hasRails: true, projectType: 'monolith',
      tables: [], routes: [], patterns: [], mcpServerAvailable: false,
    })
    expect(monolith).not.toContain('API-only Rails app')
    expect(monolith).not.toContain('Ruby gem, not a Rails application')
  })

  it('omits sections entirely when there is nothing to report', () => {
    const content = buildCursorRulesContent({
      rubyVersion: '3.3.0', railsVersion: '7.1.0', hasRails: true,
      tables: [], routes: [], patterns: [], mcpServerAvailable: false,
    })
    expect(content).not.toContain('## Database Schema')
    expect(content).not.toContain('## Routes')
    expect(content).not.toContain('## Existing Patterns')
  })
})

describe('buildSystemPromptMarkdown', () => {
  const table: SchemaTable = {
    name: 'posts',
    columns: new Map([['title', { name: 'title', type: 'string', nullable: false }]]),
    indexes: [],
    foreignKeys: [],
  }
  const route: RailsRoute = { verb: 'POST', uriPattern: '/posts', controller: 'posts', action: 'create' }
  const pattern: IndexedPattern = {
    id: '1', type: 'query', name: 'SearchPostsQuery', filePath: '/repo/app/queries/search_posts_query.rb',
    lineStart: 1, publicMethods: ['call'], preview: '',
  }

  it('includes RailsForge Project Context header', () => {
    const content = buildSystemPromptMarkdown({
      rubyVersion: '3.3.0', railsVersion: '7.1.0', hasRails: true,
      tables: [], routes: [], patterns: [], mcpServerAvailable: false,
    })
    expect(content).toContain('# RailsForge Project Context')
    expect(content).toContain('Rails 7.1.0 on Ruby 3.3.0')
  })

  it('states standalone Ruby for non-Rails projects', () => {
    const content = buildSystemPromptMarkdown({
      rubyVersion: '3.2.0', hasRails: false,
      tables: [], routes: [], patterns: [], mcpServerAvailable: false,
    })
    expect(content).toContain('standalone Ruby 3.2.0 project')
    expect(content).toContain('not Rails')
  })

  it('includes Engineering Rules section', () => {
    const content = buildSystemPromptMarkdown({
      rubyVersion: '3.3.0', hasRails: true,
      tables: [], routes: [], patterns: [], mcpServerAvailable: false,
    })
    expect(content).toContain('## Engineering Rules')
    expect(content).toContain('SOLID principles')
    expect(content).toContain('N+1 queries')
    expect(content).toContain('rescue Exception')
    expect(content).toContain('Data.define')
  })

  it('includes Database Schema when tables are present', () => {
    const content = buildSystemPromptMarkdown({
      rubyVersion: '3.3.0', hasRails: true,
      tables: [table], routes: [], patterns: [], mcpServerAvailable: false,
    })
    expect(content).toContain('## Database Schema')
    expect(content).toContain('`posts`: title:string')
  })

  it('omits Database Schema when no tables', () => {
    const content = buildSystemPromptMarkdown({
      rubyVersion: '3.3.0', hasRails: true,
      tables: [], routes: [], patterns: [], mcpServerAvailable: false,
    })
    expect(content).not.toContain('## Database Schema')
  })

  it('includes Routes section (first 40) when routes are present', () => {
    const manyRoutes = Array.from({ length: 50 }, (_, i) => ({
      verb: 'GET', uriPattern: `/r${i}`, controller: 'c', action: `a${i}`,
    })) as RailsRoute[]
    const content = buildSystemPromptMarkdown({
      rubyVersion: '3.3.0', hasRails: true,
      tables: [], routes: manyRoutes, patterns: [], mcpServerAvailable: false,
    })
    expect(content).toContain('## Routes')
    expect(content).toContain('/r39')
    expect(content).not.toContain('/r40')
  })

  it('includes Existing Patterns when patterns are present', () => {
    const content = buildSystemPromptMarkdown({
      rubyVersion: '3.3.0', hasRails: true,
      tables: [], routes: [], patterns: [pattern], mcpServerAvailable: false,
    })
    expect(content).toContain('## Existing Patterns (do not duplicate)')
    expect(content).toContain('**query**: SearchPostsQuery')
  })

  it('ends with generated by RailsForge footer', () => {
    const content = buildSystemPromptMarkdown({
      rubyVersion: '3.3.0', hasRails: true,
      tables: [], routes: [], patterns: [], mcpServerAvailable: false,
    })
    expect(content).toContain('Generated by RailsForge')
    expect(content).toContain('Re-run "RailsForge: Copy System Prompt"')
  })
})
