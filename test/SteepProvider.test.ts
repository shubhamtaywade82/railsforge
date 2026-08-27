const { mockExecFile } = vi.hoisted(() => {
  const mockExecFile = vi.fn()
  return { mockExecFile }
})

vi.mock('child_process', () => ({ execFile: mockExecFile }))
vi.mock('util', () => ({ promisify: () => mockExecFile }))

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseSteepGithubOutput, SteepProvider } from '../src/types/SteepProvider'

// Real `steep check --format=github` output against a scratch project with a type
// mismatch — verified before writing the parser, not guessed at.
const REAL_STEEP_OUTPUT = `# Type checking files:

.F

::error file=lib/greeter.rb,line=7,endLine=7,col=18,endColumn=20::[Ruby::ArgumentTypeMismatch] Cannot pass a value of type \`::Integer\` as an argument of type \`::String\`%0A  ::Integer <: ::String%0A    ::Numeric <: ::String%0A      ::Object <: ::String%0A        ::BasicObject <: ::String
Detected 1 problem from 1 file
`

const REAL_STEEP_WARNING_OUTPUT = `# Type checking files:

.F

::warning file=lib/greeter.rb,line=6,endLine=6,col=6,endColumn=12::[Ruby::UndeclaredMethodDefinition] Method \`::Greeter#unused\` is not declared in RBS
Detected 1 problem from 1 file
`

describe('parseSteepGithubOutput', () => {
  it('parses an error diagnostic and strips the boxed type-relation trace', () => {
    const diagnostics = parseSteepGithubOutput(REAL_STEEP_OUTPUT)
    expect(diagnostics).toEqual([{
      severity: 'error',
      file: 'lib/greeter.rb',
      line: 7,
      endLine: 7,
      col: 18,
      endColumn: 20,
      message: '[Ruby::ArgumentTypeMismatch] Cannot pass a value of type `::Integer` as an argument of type `::String`',
    }])
  })

  it('parses a warning diagnostic', () => {
    const diagnostics = parseSteepGithubOutput(REAL_STEEP_WARNING_OUTPUT)
    expect(diagnostics[0].severity).toBe('warning')
    expect(diagnostics[0].message).toBe('[Ruby::UndeclaredMethodDefinition] Method `::Greeter#unused` is not declared in RBS')
  })

  it('ignores non-diagnostic lines', () => {
    expect(parseSteepGithubOutput('# Type checking files:\n\n.F\n\nDetected 1 problem from 1 file\n')).toEqual([])
  })

  it('returns an empty list for clean output', () => {
    expect(parseSteepGithubOutput('# Type checking files:\n\n.\n\nNo type error detected.\n')).toEqual([])
  })

  it('preserves a literal percent sign in a message unrelated to escaping', () => {
    const line = '::error file=a.rb,line=1,endLine=1,col=1,endColumn=2::50%25 chance of failure'
    expect(parseSteepGithubOutput(line)[0].message).toBe('50% chance of failure')
  })
})

describe('SteepProvider', () => {
  let provider: SteepProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new SteepProvider()
  })

  it('returns diagnostics from bundle exec steep check', async () => {
    mockExecFile.mockResolvedValue({ stdout: REAL_STEEP_OUTPUT })
    const result = await provider.runCheck('/workspace')
    expect(result).toHaveLength(1)
    expect(result[0].severity).toBe('error')
    expect(mockExecFile).toHaveBeenCalledWith('bundle', ['exec', 'steep', 'check', '--format=github'], expect.objectContaining({ cwd: '/workspace' }))
  })

  it('falls back to bare steep when bundle exec fails with no stdout', async () => {
    mockExecFile
      .mockRejectedValueOnce({ stdout: undefined })
      .mockResolvedValueOnce({ stdout: REAL_STEEP_WARNING_OUTPUT })

    const result = await provider.runCheck('/workspace')
    expect(result).toHaveLength(1)
    expect(result[0].severity).toBe('warning')
    expect(mockExecFile).toHaveBeenNthCalledWith(2, 'steep', ['check', '--format=github'], expect.objectContaining({ cwd: '/workspace' }))
  })

  it('returns empty array when both bundle exec and bare steep fail', async () => {
    mockExecFile
      .mockRejectedValueOnce({ stdout: undefined })
      .mockRejectedValueOnce({ stdout: undefined })

    const result = await provider.runCheck('/workspace')
    expect(result).toEqual([])
  })

  it('parses diagnostics from stderr exit code (steep exits non-zero on errors)', async () => {
    mockExecFile.mockRejectedValue({
      stdout: '::error file=a.rb,line=1,endLine=1,col=1,endColumn=5::type error\n',
    })

    const result = await provider.runCheck('/workspace')
    expect(result).toHaveLength(1)
    expect(result[0].message).toBe('type error')
  })

  it('parses diagnostics from error with empty stdout string as null', async () => {
    mockExecFile
      .mockRejectedValueOnce({ stdout: '' })
      .mockRejectedValueOnce({ stdout: '' })

    const result = await provider.runCheck('/workspace')
    expect(result).toEqual([])
  })

  it('parses notice-level diagnostics correctly', async () => {
    const noticeOutput = '::notice file=a.rb,line=1,endLine=1,col=1,endColumn=2::just a notice'
    mockExecFile.mockResolvedValue({ stdout: noticeOutput })

    const result = await provider.runCheck('/workspace')
    expect(result).toHaveLength(1)
    expect(result[0].severity).toBe('notice')
    expect(result[0].message).toBe('just a notice')
  })
})
