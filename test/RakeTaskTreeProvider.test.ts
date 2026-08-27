import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RakeTaskTreeProvider, RakeTaskItem } from '../src/rake/RakeTaskTreeProvider'

describe('RakeTaskTreeProvider', () => {
  const indexer = {
    listTasks: vi.fn().mockResolvedValue([]),
  } as any

  let provider: RakeTaskTreeProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new RakeTaskTreeProvider(indexer, '/workspace')
  })

  it('should return empty for no workspace root', async () => {
    const emptyProvider = new RakeTaskTreeProvider(indexer, '')
    const children = await emptyProvider.getChildren()
    expect(children).toEqual([])
  })

  it('should return namespace groups and top-level tasks', async () => {
    vi.mocked(indexer.listTasks).mockResolvedValue([
      { name: 'db:migrate', namespace: 'db', description: 'Run migrations' },
      { name: 'db:rollback', namespace: 'db', description: 'Rollback migrations' },
      { name: 'about', namespace: null, description: 'List Rails info' },
    ])

    const children = await provider.getChildren()
    const labels = children.map(c => c.label)
    expect(labels).toContain('db')
    expect(labels).toContain('about')
  })

  it('should return tasks for a namespace', async () => {
    vi.mocked(indexer.listTasks).mockResolvedValue([
      { name: 'db:migrate', namespace: 'db', description: 'Run migrations' },
      { name: 'db:rollback', namespace: 'db', description: 'Rollback' },
    ])

    const children = await provider.getChildren()
    const nsItem = children.find(c => c.label === 'db')
    expect(nsItem).toBeDefined()

    const tasks = await provider.getChildren(nsItem!)
    expect(tasks.length).toBe(2)
    expect(tasks[0].label).toBe('db:migrate')
  })

  it('should refresh tasks', () => {
    expect(() => provider.refresh()).not.toThrow()
  })

  it('getTreeItem should return the element itself', () => {
    const item = new RakeTaskItem('test', 0)
    expect(provider.getTreeItem(item)).toBe(item)
  })
})
