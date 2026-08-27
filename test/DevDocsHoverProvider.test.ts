import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DevDocsHoverProvider } from '../src/docs/DevDocsHoverProvider'

describe('DevDocsHoverProvider', () => {
  let offlineIndex: { lookup: ReturnType<typeof vi.fn> }
  let isEnabled: ReturnType<typeof vi.fn>
  let provider: DevDocsHoverProvider

  beforeEach(() => {
    vi.clearAllMocks()
    offlineIndex = { lookup: vi.fn().mockReturnValue(null) }
    isEnabled = vi.fn().mockReturnValue(true)
    provider = new DevDocsHoverProvider({ index: offlineIndex } as any, isEnabled as any)
  })

  it('should return null when disabled', () => {
    vi.mocked(isEnabled).mockReturnValue(false)
    const mockDoc = { getWordRangeAtPosition: vi.fn().mockReturnValue(null) } as any
    const result = provider.provideHover(mockDoc, { line: 0, character: 0 } as any)
    expect(result).toBeNull()
  })

  it('should return null when word not found in index', () => {
    const mockDoc = { getWordRangeAtPosition: vi.fn().mockReturnValue(null) } as any
    const result = provider.provideHover(mockDoc, { line: 0, character: 2 } as any)
    expect(result).toBeNull()
  })

  it('should return hover with devdocs result', () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }
    const mockDoc = {
      getWordRangeAtPosition: vi.fn().mockReturnValue(range),
      getText: vi.fn().mockReturnValue('save'),
    } as any
    vi.mocked(offlineIndex.lookup).mockReturnValue({
      name: 'save',
      signature: 'save(*) -> Boolean',
      description: 'Saves the record',
      url: 'https://devdocs.io/rails',
      slug: 'rails',
    })
    const result = provider.provideHover(mockDoc, { line: 0, character: 2 } as any)
    expect(result).not.toBeNull()
  })
})
