const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}))

vi.mock('child_process', () => ({ execFile: mockExecFile }))
vi.mock('util', () => ({ promisify: () => mockExecFile }))

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseRakeTaskList, RakeTaskIndexer } from '../src/rake/RakeTaskIndexer'

// Real `rake -T` output against a scratch Rakefile with a namespace, a top-level task,
// and a parameterized task — verified before writing the parser, not guessed.
const REAL_RAKE_T_OUTPUT = `rake about        # List versions of all Rails frameworks and the environment
rake db:migrate   # Migrate the database
rake db:rollback  # Rolls the schema back to the previous version
rake greet[name]  # A parameterized task
`

describe('parseRakeTaskList', () => {
  it('parses namespaced, top-level, and parameterized tasks', () => {
    const tasks = parseRakeTaskList(REAL_RAKE_T_OUTPUT)
    expect(tasks).toEqual([
      { name: 'about', namespace: null, description: 'List versions of all Rails frameworks and the environment' },
      { name: 'db:migrate', namespace: 'db', description: 'Migrate the database' },
      { name: 'db:rollback', namespace: 'db', description: 'Rolls the schema back to the previous version' },
      { name: 'greet[name]', namespace: null, description: 'A parameterized task' },
    ])
  })

  it('ignores non-task lines and blank lines', () => {
    const tasks = parseRakeTaskList('\nsome warning to stderr-like noise\nrake about  # desc\n\n')
    expect(tasks).toEqual([{ name: 'about', namespace: null, description: 'desc' }])
  })

  it('returns an empty list for empty output', () => {
    expect(parseRakeTaskList('')).toEqual([])
  })
})

describe('RakeTaskIndexer', () => {
  let indexer: RakeTaskIndexer

  beforeEach(() => {
    vi.clearAllMocks()
    indexer = new RakeTaskIndexer()
  })

  it('returns tasks from bundle exec rake -T', async () => {
    mockExecFile.mockResolvedValue({ stdout: REAL_RAKE_T_OUTPUT })
    const tasks = await indexer.listTasks('/workspace')
    expect(tasks).toHaveLength(4)
    expect(tasks[0].name).toBe('about')
    expect(mockExecFile).toHaveBeenCalledWith('bundle', ['exec', 'rake', '-T'], expect.objectContaining({ cwd: '/workspace' }))
  })

  it('falls back to bare rake when bundle exec fails', async () => {
    mockExecFile
      .mockRejectedValueOnce(new Error('bundle not found'))
      .mockResolvedValueOnce({ stdout: 'rake custom  # Custom task\n' })

    const tasks = await indexer.listTasks('/workspace')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].name).toBe('custom')
    expect(mockExecFile).toHaveBeenNthCalledWith(2, 'rake', ['-T'], expect.objectContaining({ cwd: '/workspace' }))
  })

  it('returns empty array when both bundle exec and bare rake fail', async () => {
    mockExecFile
      .mockRejectedValueOnce(new Error('bundle not found'))
      .mockRejectedValueOnce(new Error('rake not found'))

    const tasks = await indexer.listTasks('/workspace')
    expect(tasks).toEqual([])
  })

  it('returns empty array from empty stdout via bundle', async () => {
    mockExecFile.mockResolvedValue({ stdout: '' })
    const tasks = await indexer.listTasks('/workspace')
    expect(tasks).toEqual([])
    // Empty array is truthy, so no fallback to bare rake
    expect(mockExecFile).toHaveBeenCalledTimes(1)
  })

  it('falls back when bundle exec rejects with plain error', async () => {
    mockExecFile
      .mockRejectedValueOnce({})
      .mockResolvedValueOnce({ stdout: 'rake db:migrate  # Migrate\n' })

    const tasks = await indexer.listTasks('/workspace')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].name).toBe('db:migrate')
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })
})
