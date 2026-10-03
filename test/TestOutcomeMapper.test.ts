import { describe, it, expect } from 'vitest'
import { mapRspecOutcomes, mapMinitestOutcomes, minitestMethodName } from '../src/testing/TestOutcomeMapper'
import { buildRdbgLaunchConfig } from '../src/testing/RdbgConfig'
import { ExampleResult } from '../src/testing/TestResultParsers'

const leaves = [
  { id: 'a', name: 'is valid', line: 6 },
  { id: 'b', name: 'joins names', line: 11 },
  { id: 'c', name: 'later', line: 19 },
]

const ex = (line: number, status: ExampleResult['status'], failure?: ExampleResult['failure']): ExampleResult => ({
  line, status, filePath: 'spec/x_spec.rb', fullDescription: '', durationMs: 5, failure,
})

describe('mapRspecOutcomes', () => {
  it('maps passed / failed (with location) / pending by declaration line', () => {
    const out = mapRspecOutcomes(leaves, [ex(7, 'passed'), ex(12, 'failed', { message: 'boom', line: 14 }), ex(20, 'pending')], 1, '')
    expect(out.get('a')).toEqual({ status: 'passed', durationMs: 5 })
    expect(out.get('b')).toEqual({ status: 'failed', message: 'boom', line: 14, durationMs: 5 })
    expect(out.get('c')).toEqual({ status: 'skipped' })
  })

  it('errors every leaf with the raw output when no JSON was produced', () => {
    const out = mapRspecOutcomes(leaves, undefined, 1, 'LoadError: no such file')
    expect([...out.values()].every(o => o.status === 'errored')).toBe(true)
    expect(out.get('a')).toMatchObject({ message: 'LoadError: no such file' })
  })

  it('an unreported leaf is passed on a green run but errored on a red one', () => {
    expect(mapRspecOutcomes([leaves[0]], [], 0, '').get('a')).toEqual({ status: 'passed' })
    expect(mapRspecOutcomes([leaves[0]], [], 1, '').get('a')).toMatchObject({ status: 'errored' })
  })
})

describe('mapMinitestOutcomes', () => {
  const mt = [
    { id: 'v', name: 'valid', line: 3 },
    { id: 'n', name: 'test_name_present', line: 6 },
    { id: 'o', name: 'other thing', line: 9 },
  ]

  it('derives method names for string tests', () => {
    expect(minitestMethodName('valid')).toBe('test_valid')
    expect(minitestMethodName('other thing')).toBe('test_other_thing')
    expect(minitestMethodName('test_x')).toBe('test_x')
  })

  it('matches failures by method name and passes the rest', () => {
    const out = mapMinitestOutcomes(mt, [
      { kind: 'Failure', testName: 'UserTest#test_valid', filePath: 't.rb', line: 4, message: 'nope' },
      { kind: 'Error', testName: 'UserTest#test_other_thing', filePath: 't.rb', line: 10, message: 'boom' },
    ], 1, '')
    expect(out.get('v')).toEqual({ status: 'failed', message: 'nope', line: 4 })
    expect(out.get('n')).toEqual({ status: 'passed' })
    expect(out.get('o')).toMatchObject({ status: 'failed', message: 'boom' })
  })

  it('falls back to the nearest preceding declaration by line', () => {
    const out = mapMinitestOutcomes(mt, [
      { kind: 'Failure', testName: 'UserTest#test_renamed', filePath: 't.rb', line: 7, message: 'x' },
    ], 1, '')
    expect(out.get('n')).toMatchObject({ status: 'failed' })
    expect(out.get('v')).toEqual({ status: 'passed' })
  })

  it('errors everything on a non-zero exit with no parsed failures', () => {
    const out = mapMinitestOutcomes(mt, [], 1, 'cannot load such file -- rails_helper')
    expect(out.get('v')).toMatchObject({ status: 'errored', message: 'cannot load such file -- rails_helper' })
  })
})

describe('buildRdbgLaunchConfig', () => {
  it('splits the launcher from the test target and quotes paths with spaces', () => {
    const cfg = buildRdbgLaunchConfig('Debug', '/my app', '/my app/bin/rspec', ['/my app/spec/x_spec.rb:12'])
    expect(cfg).toMatchObject({ type: 'rdbg', request: 'launch', command: '"/my app/bin/rspec"', script: '/my app/spec/x_spec.rb:12', cwd: '/my app' })
    expect(buildRdbgLaunchConfig('D', '/p', 'bundle', ['exec', 'rspec', 'a_spec.rb:3'])).toMatchObject({ command: 'bundle exec rspec', script: 'a_spec.rb:3' })
  })
})
