import { describe, it, expect } from 'vitest'
import { analyzeNPlusOne } from '../src/rails/NPlusOneAnalyzer'

const tables = [
  { name: 'posts', columns: ['id', 'title', 'user_id'] },
  { name: 'users', columns: ['id', 'name'] },
  { name: 'comments', columns: ['id', 'post_id', 'body'] },
]

describe('analyzeNPlusOne', () => {
  it('flags association access inside an each block without eager loading', () => {
    const code = [
      'Post.all.each do |post|',
      '  puts post.user.name',
      'end',
    ].join('\n')
    const f = analyzeNPlusOne(code, tables)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ line: 1, variable: 'post', association: 'user', accessLine: 2, collection: 'Post.all' })
  })

  it('flags brace blocks', () => {
    const f = analyzeNPlusOne('Comment.all.map { |c| c.post.title }', tables)
    expect(f.map(x => x.association)).toEqual(['post'])
  })

  it('ignores collections that are eager loaded', () => {
    const code = 'Post.includes(:user).each do |post|\n  post.user.name\nend'
    expect(analyzeNPlusOne(code, tables)).toEqual([])
  })

  it('ignores plain attributes and accesses outside the block', () => {
    const code = ['Post.all.each do |post|', '  puts post.title', 'end', 'post.user'].join('\n')
    expect(analyzeNPlusOne(code, tables)).toEqual([])
  })

  it('returns nothing without a schema', () => {
    expect(analyzeNPlusOne('A.each { |a| a.user }', [])).toEqual([])
  })
})
