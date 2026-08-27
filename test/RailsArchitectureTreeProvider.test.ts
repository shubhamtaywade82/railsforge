import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RailsArchitectureTreeProvider, ArchitectureItem } from '../src/views/RailsArchitectureTreeProvider'

describe('RailsArchitectureTreeProvider', () => {
  const env = {
    rubyVersion: '3.3.0',
    railsVersion: '7.1.0',
    hasRails: true,
    hasHotwire: true,
    hasStrongMigrations: true,
    projectType: 'rails',
    testFramework: 'rspec',
  } as any

  const schemaIndexer = {
    getAllTables: vi.fn().mockReturnValue([
      { name: 'users', columns: new Map([['id', { name: 'id', type: 'bigint', nullable: false, default: null }]]) },
      { name: 'posts', columns: new Map() },
    ]),
  } as any

  const routesIndexer = {
    getAllRoutes: vi.fn().mockReturnValue([
      { verb: 'GET', uriPattern: '/users', controller: 'users', action: 'index' },
      { verb: 'GET', uriPattern: '/users/:id', controller: 'users', action: 'show' },
      { verb: 'GET', uriPattern: '/posts', controller: 'posts', action: 'index' },
    ]),
  } as any

  const stimulusIndexer = {
    getAllControllers: vi.fn().mockReturnValue([
      { identifier: 'hello', targets: ['output'], actions: ['greet'] },
    ]),
  } as any

  let provider: RailsArchitectureTreeProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new RailsArchitectureTreeProvider(env, schemaIndexer, routesIndexer, stimulusIndexer)
  })

  it('should return root items with correct labels', async () => {
    const children = await provider.getChildren()
    expect(children.length).toBe(3)
    expect(children[0].label).toBe('Runtime Environment')
    expect(children[1].label).toBe('Database & Models')
    expect(children[2].label).toBe('Routes & Hotwire')
  })

  it('should return environment children', async () => {
    const envItem = new ArchitectureItem('Runtime Environment', 2)
    const children = await provider.getChildren(envItem)
    expect(children.length).toBe(6)
    expect(children[0].label).toContain('Ruby')
    expect(children[1].label).toContain('Rails')
  })

  it('should return database children', async () => {
    const dbItem = new ArchitectureItem('Database & Models', 1)
    const children = await provider.getChildren(dbItem)
    expect(children.length).toBe(2)
    expect(children[0].label).toBe('users')
    expect(children[1].label).toBe('posts')
  })

  it('should return routes & hotwire children', async () => {
    const rhItem = new ArchitectureItem('Routes & Hotwire', 1)
    const children = await provider.getChildren(rhItem)
    expect(children.some(c => c.label === 'Total Routes: 3')).toBe(true)
    expect(children.some(c => c.label.includes('Stimulus:'))).toBe(true)
  })

  it('should return routes for a specific controller', async () => {
    const groupItem = new ArchitectureItem('users', 1)
    groupItem.contextValue = 'routeGroup'
    const children = await provider.getChildren(groupItem)
    expect(children.length).toBe(2)
    expect(children[0].label).toContain('GET')
  })

  it('should refresh with new env', () => {
    expect(() => provider.refresh({ ...env, rubyVersion: '3.4.0' })).not.toThrow()
  })

  it('getTreeItem should return the element itself', () => {
    const item = new ArchitectureItem('test', 0)
    expect(provider.getTreeItem(item)).toBe(item)
  })
})
