import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiDockHoverProvider } from '../src/docs/ApiDockHoverProvider'

describe('ApiDockHoverProvider', () => {
  let client: { fetchNotes: ReturnType<typeof vi.fn> }
  let methodIndex: { lookup: ReturnType<typeof vi.fn> }
  let isEnabled: ReturnType<typeof vi.fn>
  let provider: ApiDockHoverProvider

  beforeEach(() => {
    vi.clearAllMocks()
    client = { fetchNotes: vi.fn() }
    methodIndex = { lookup: vi.fn().mockReturnValue(null) }
    isEnabled = vi.fn().mockReturnValue(true)
    provider = new ApiDockHoverProvider(client as any, methodIndex as any, isEnabled as any)
  })

  it('should return null when disabled', async () => {
    vi.mocked(isEnabled).mockReturnValue(false)
    const mockDoc = {
      getWordRangeAtPosition: vi.fn().mockReturnValue(null),
      getText: vi.fn().mockReturnValue('save'),
    } as any
    const result = await provider.provideHover(mockDoc, { line: 0, character: 2 } as any)
    expect(result).toBeNull()
  })

  it('should return null when method not in index', async () => {
    const mockDoc = {
      getWordRangeAtPosition: vi.fn().mockReturnValue(null),
      getText: vi.fn().mockReturnValue('save'),
    } as any
    const result = await provider.provideHover(mockDoc, { line: 0, character: 2 } as any)
    expect(result).toBeNull()
  })

  it('should return null when no notes available', async () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }
    const mockDoc = {
      getWordRangeAtPosition: vi.fn().mockReturnValue(range),
      getText: vi.fn().mockReturnValue('save'),
    } as any
    vi.mocked(methodIndex.lookup).mockReturnValue({ className: 'ActiveRecord/Base', methodName: 'save' })
    vi.mocked(client.fetchNotes).mockResolvedValue(null)
    const result = await provider.provideHover(mockDoc, { line: 0, character: 2 } as any)
    expect(result).toBeNull()
  })

  it('should return hover with note', async () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }
    const mockDoc = {
      getWordRangeAtPosition: vi.fn().mockReturnValue(range),
      getText: vi.fn().mockReturnValue('save'),
    } as any
    vi.mocked(methodIndex.lookup).mockReturnValue({ className: 'ActiveRecord/Base', methodName: 'save' })
    vi.mocked(client.fetchNotes).mockResolvedValue({
      summary: 'Saves the model',
      topNote: 'Be careful with validations',
      url: 'https://apidock.com/rails/ActiveRecord/Base/save',
    })
    const result = await provider.provideHover(mockDoc, { line: 0, character: 2 } as any)
    expect(result).not.toBeNull()
  })
})
