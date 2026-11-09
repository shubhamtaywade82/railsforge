import { describe, it, expect, vi } from 'vitest'
import { SemanticIndexAdapter } from '../src/providers/EngineAdapters'
import type { PersistentIndexManager } from '../src/indexer/PersistentIndexManager'
import type { DuplicateMethodPair } from '../src/indexer/DuplicateMethodDetector'

const ROOT = '/repo'
const PAIR: DuplicateMethodPair = {
  a: { name: 'create', filePath: `${ROOT}/app/controllers/orders_controller.rb`, startLine: 2, endLine: 7 },
  b: { name: 'call', filePath: `${ROOT}/app/services/checkout_service.rb`, startLine: 4, endLine: 9 },
  similarity: 0.93,
}

// The adapter never reads the linter in these tests, so a stub stands in for it.
const NO_LINTER = {} as never

function fakeManager(findDuplicates: () => DuplicateMethodPair[], generation: { value: number }): PersistentIndexManager {
  return {
    duplicateDetector: { findDuplicates },
    get indexGeneration() {
      return generation.value
    },
  } as unknown as PersistentIndexManager
}

describe('SemanticIndexAdapter.duplicateMethods', () => {
  it('returns no groups when there is no persistent index', () => {
    const adapter = new SemanticIndexAdapter(ROOT, undefined, NO_LINTER)
    expect(adapter.duplicateMethods()).toEqual([])
  })

  it('returns no groups when the workspace root is unknown', () => {
    const findDuplicates = vi.fn(() => [PAIR])
    const adapter = new SemanticIndexAdapter(undefined, fakeManager(findDuplicates, { value: 1 }), NO_LINTER)
    expect(adapter.duplicateMethods()).toEqual([])
    expect(findDuplicates).not.toHaveBeenCalled()
  })

  it('converts detector pairs to workspace-relative groups', () => {
    const adapter = new SemanticIndexAdapter(ROOT, fakeManager(() => [PAIR], { value: 1 }), NO_LINTER)
    const [group] = adapter.duplicateMethods()

    expect(group.similarity).toBe(0.93)
    expect(group.occurrences.map(o => o.relativePath)).toEqual([
      'app/controllers/orders_controller.rb',
      'app/services/checkout_service.rb',
    ])
  })

  it('runs the full detector once per index generation', () => {
    const findDuplicates = vi.fn(() => [PAIR])
    const generation = { value: 1 }
    const adapter = new SemanticIndexAdapter(ROOT, fakeManager(findDuplicates, generation), NO_LINTER)

    adapter.duplicateMethods()
    adapter.duplicateMethods()
    adapter.duplicateMethods()
    expect(findDuplicates).toHaveBeenCalledTimes(1)

    generation.value = 2
    adapter.duplicateMethods()
    adapter.duplicateMethods()
    expect(findDuplicates).toHaveBeenCalledTimes(2)
  })

  it('reflects an index write that removed a duplicate', () => {
    let pairs: DuplicateMethodPair[] = [PAIR]
    const generation = { value: 1 }
    const adapter = new SemanticIndexAdapter(ROOT, fakeManager(() => pairs, generation), NO_LINTER)
    expect(adapter.duplicateMethods()).toHaveLength(1)

    pairs = []
    generation.value = 2
    expect(adapter.duplicateMethods()).toEqual([])
  })
})
