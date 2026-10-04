import { describe, it, expect } from 'vitest'
import { parseRspecJson, parseMinitestOutput, lineInFile } from '../src/testing/TestResultParsers'

const RSPEC_JSON = JSON.stringify({
  version: '3.13.0',
  examples: [
    { full_description: 'User is valid', status: 'passed', file_path: './spec/models/user_spec.rb', line_number: 7, run_time: 0.0123 },
    {
      full_description: 'User joins names', status: 'failed', file_path: './spec/models/user_spec.rb', line_number: 12, run_time: 0.5,
      exception: {
        class: 'RSpec::Expectations::ExpectationNotMetError',
        message: 'expected "A" got "B"',
        backtrace: ['/gems/rspec-core/lib/x.rb:1:in `run`', '/app/spec/models/user_spec.rb:14:in `block (3 levels)`'],
      },
    },
    { full_description: 'User later', status: 'pending', file_path: './spec/models/user_spec.rb', line_number: 20 },
  ],
})

describe('parseRspecJson', () => {
  it('maps examples to statuses, durations and failure locations', () => {
    const results = parseRspecJson(`warning: something\n${RSPEC_JSON}`)!
    expect(results.map(r => [r.line, r.status])).toEqual([[7, 'passed'], [12, 'failed'], [20, 'pending']])
    expect(results[0]).toMatchObject({ filePath: 'spec/models/user_spec.rb', durationMs: 12 })
    expect(results[1].failure).toEqual({
      message: 'RSpec::Expectations::ExpectationNotMetError: expected "A" got "B"',
      line: 14,
    })
  })

  it('returns undefined for non-JSON output and malformed JSON', () => {
    expect(parseRspecJson('LoadError: cannot load such file')).toBeUndefined()
    expect(parseRspecJson('{"version": "3", "examples": [')).toBeUndefined()
  })

  it('lineInFile matches relative and absolute backtrace paths', () => {
    expect(lineInFile(['/a/b/spec/x_spec.rb:9:in `x`'], 'spec/x_spec.rb')).toBe(9)
    expect(lineInFile(['spec/x_spec.rb:3'], '/a/b/spec/x_spec.rb')).toBe(3)
    expect(lineInFile(['lib/other.rb:3'], 'spec/x_spec.rb')).toBeUndefined()
  })
})

describe('parseMinitestOutput', () => {
  const OUT = [
    'Run options: --seed 1234',
    '',
    '# Running:',
    '',
    'F.E',
    '',
    'Failure:',
    'UserTest#test_valid [test/models/user_test.rb:5]:',
    'Expected: true',
    '  Actual: false',
    '',
    'Error:',
    'UserTest#test_name [test/models/user_test.rb:9]:',
    'NoMethodError: undefined method `x\' for nil',
    '    test/models/user_test.rb:10:in `block in <class:UserTest>\'',
    '',
    '3 runs, 4 assertions, 1 failures, 1 errors, 0 skips',
  ].join('\n')

  it('extracts failures and errors with locations and messages', () => {
    const { failures, summary } = parseMinitestOutput(OUT)
    expect(failures).toHaveLength(2)
    expect(failures[0]).toMatchObject({ kind: 'Failure', testName: 'UserTest#test_valid', filePath: 'test/models/user_test.rb', line: 5 })
    expect(failures[0].message).toContain('Expected: true')
    expect(failures[1]).toMatchObject({ kind: 'Error', line: 9 })
    expect(summary).toEqual({ runs: 3, assertions: 4, failures: 1, errors: 1, skips: 0 })
  })

  it('handles a green run', () => {
    expect(parseMinitestOutput('2 runs, 2 assertions, 0 failures, 0 errors, 0 skips')).toEqual({
      failures: [], summary: { runs: 2, assertions: 2, failures: 0, errors: 0, skips: 0 },
    })
  })
})
