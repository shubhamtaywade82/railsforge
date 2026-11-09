import { describe, it, expect } from 'vitest'
import { crossFileDuplicatesFor } from '../src/refactoring-intelligence/core/CrossFileDuplicates'
import { toDuplicateGroups } from '../src/providers/duplicateGroups'
import type { DuplicateMethodPair } from '../src/indexer/DuplicateMethodDetector'

const ROOT = '/repo'

describe('crossFileDuplicatesFor', () => {
  const group = {
    similarity: 0.9,
    occurrences: [
      { relativePath: 'app/a.rb', lineStart: 2, lineEnd: 7, methodName: 'create' },
      { relativePath: 'app/b.rb', lineStart: 4, lineEnd: 9, methodName: 'call' },
    ],
  }

  it('lists the other copies for each side of a pair', () => {
    expect(crossFileDuplicatesFor([group], 'app/a.rb')).toEqual([
      {
        lineStart: 2, lineEnd: 7, methodName: 'create',
        otherPath: 'app/b.rb', otherLineStart: 4, otherLineEnd: 9, otherMethodName: 'call',
        similarity: 0.9,
      },
    ])
    expect(crossFileDuplicatesFor([group], 'app/b.rb')).toEqual([
      expect.objectContaining({ lineStart: 4, methodName: 'call', otherPath: 'app/a.rb', otherMethodName: 'create' }),
    ])
  })

  it('returns nothing for a file that is in no group', () => {
    expect(crossFileDuplicatesFor([group], 'app/c.rb')).toEqual([])
  })

  it('ignores groups whose copies are all in the same file', () => {
    const sameFile = {
      similarity: 0.95,
      occurrences: [
        { relativePath: 'app/a.rb', lineStart: 2, lineEnd: 7, methodName: 'create' },
        { relativePath: 'app/a.rb', lineStart: 20, lineEnd: 25, methodName: 'store' },
      ],
    }
    expect(crossFileDuplicatesFor([sameFile], 'app/a.rb')).toEqual([])
  })

  it('pairs a method with every copy in other files', () => {
    const three = {
      similarity: 0.8,
      occurrences: [
        { relativePath: 'app/a.rb', lineStart: 2, lineEnd: 7, methodName: 'create' },
        { relativePath: 'app/b.rb', lineStart: 4, lineEnd: 9, methodName: 'call' },
        { relativePath: 'app/c.rb', lineStart: 1, lineEnd: 6, methodName: 'perform' },
      ],
    }
    const entries = crossFileDuplicatesFor([three], 'app/a.rb')
    expect(entries.map(e => e.otherPath)).toEqual(['app/b.rb', 'app/c.rb'])
  })

  it('treats a group without a similarity as 0', () => {
    const unscored = { occurrences: group.occurrences }
    expect(crossFileDuplicatesFor([unscored], 'app/a.rb')[0].similarity).toBe(0)
  })
})

describe('toDuplicateGroups', () => {
  const pair = (overrides: Partial<DuplicateMethodPair> = {}): DuplicateMethodPair => ({
    a: { name: 'create', filePath: `${ROOT}/app/a.rb`, startLine: 2, endLine: 7 },
    b: { name: 'call', filePath: `${ROOT}/app/b.rb`, startLine: 4, endLine: 9 },
    similarity: 0.91,
    ...overrides,
  })

  it('converts absolute detector sites to workspace-relative occurrences', () => {
    const [group] = toDuplicateGroups([pair()], ROOT)

    expect(group.similarity).toBe(0.91)
    expect(group.occurrences).toEqual([
      { relativePath: 'app/a.rb', lineStart: 2, lineEnd: 7, methodName: 'create' },
      { relativePath: 'app/b.rb', lineStart: 4, lineEnd: 9, methodName: 'call' },
    ])
  })

  it('gives the same fingerprint whichever side of the pair is first', () => {
    const forward = toDuplicateGroups([pair()], ROOT)[0].fingerprint
    const reversed = toDuplicateGroups([pair({ a: pair().b, b: pair().a })], ROOT)[0].fingerprint
    expect(reversed).toBe(forward)
  })

  it('drops any pair with a site outside the analysed root', () => {
    const outside = pair({ b: { name: 'call', filePath: '/elsewhere/vendor/b.rb', startLine: 4, endLine: 9 } })
    expect(toDuplicateGroups([outside], ROOT)).toEqual([])
  })

  it('returns no groups for no pairs', () => {
    expect(toDuplicateGroups([], ROOT)).toEqual([])
  })
})
