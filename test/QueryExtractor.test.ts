import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryExtractor } from '../src/refactor/QueryExtractor'
import * as fs from 'fs'
import * as path from 'path'

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

describe('QueryExtractor', () => {
  let extractor: QueryExtractor

  beforeEach(() => {
    vi.clearAllMocks()
    extractor = new QueryExtractor()
  })

  it('should extract a query object with camelized name', () => {
    const result = extractor.extractQuery('ActiveUsers', 'ApplicationRecord', 'where(active: true).order(:name)', [], '/workspace')
    expect(result.queryFilePath).toContain('active_users_query.rb')
    expect(result.queryCode).toContain('class ActiveUsersQuery')
    expect(result.replacementCall).toBe('ActiveUsersQuery.call')
  })

  it('should include params in the query class', () => {
    const result = extractor.extractQuery('ByRole', 'ApplicationRecord', 'where(role: role)', ['role'], '/workspace')
    expect(result.queryCode).toContain('attr_reader :relation, :role')
    expect(result.queryCode).toContain('@role = role')
  })

  it('should strip Query suffix from name', () => {
    const result = extractor.extractQuery('ActiveUsersQuery', 'ApplicationRecord', 'all', [], '/workspace')
    expect(result.queryCode).toContain('class ActiveUsersQuery')
    expect(result.queryFilePath).toContain('active_users_query.rb')
  })

  it('should camelize snake_case names', () => {
    const result = extractor.extractQuery('active_users', 'User', 'all', [], '/workspace')
    expect(result.queryCode).toContain('class ActiveUsersQuery')
    expect(result.queryFilePath).toContain('active_users_query.rb')
    expect(result.replacementCall).toBe('ActiveUsersQuery.call')
  })

  it('should save query file to disk', () => {
    extractor.saveQueryFile('/workspace/app/queries/test_query.rb', 'content')
    expect(fs.writeFileSync).toHaveBeenCalledWith('/workspace/app/queries/test_query.rb', 'content', 'utf8')
  })

  it('should create directory if it does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    extractor.saveQueryFile('/workspace/app/queries/test_query.rb', 'content')
    expect(fs.mkdirSync).toHaveBeenCalledWith('/workspace/app/queries', { recursive: true })
  })
})
