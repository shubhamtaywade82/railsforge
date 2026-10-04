import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { buildTaskCatalog, buildCustomTask } from '../src/tasks/RailsTaskCatalog'

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as {
  contributes: { problemMatchers: Array<{ name: string; pattern: { regexp: string; file: number; line: number; message: number; column?: number } }>; taskDefinitions: Array<{ type: string }> }
}

function matcher(name: string): { re: RegExp; p: { file: number; line: number; message: number; column?: number } } {
  const m = manifest.contributes.problemMatchers.find(x => x.name === name)!
  return { re: new RegExp(m.pattern.regexp), p: m.pattern }
}

describe('buildTaskCatalog', () => {
  it('Rails + RSpec app gets rspec, rubocop, brakeman and db tasks; rspec is the default test task', () => {
    const tasks = buildTaskCatalog({ isRails: true, testFramework: 'rspec', hasBrakeman: true })
    expect(tasks.map(t => t.id)).toEqual(['test', 'rubocop', 'brakeman', 'db:migrate', 'db:rollback', 'db:prepare', 'db:seed', 'routes'])
    expect(tasks[0]).toMatchObject({ tool: 'rspec', group: 'test', isDefaultGroup: true })
  })

  it('Rails + Minitest uses `rails test`; a plain gem uses `rake test` and has no Rails/DB tasks', () => {
    expect(buildTaskCatalog({ isRails: true, testFramework: 'minitest', hasBrakeman: false })[0]).toMatchObject({ tool: 'rails', args: ['test'] })
    const gem = buildTaskCatalog({ isRails: false, testFramework: 'minitest', hasBrakeman: false })
    expect(gem[0]).toMatchObject({ tool: 'rake', args: ['test'] })
    expect(gem.some(t => t.railsOnly)).toBe(false)
  })
})

describe('buildCustomTask', () => {
  it('accepts only whitelisted tools and string args', () => {
    expect(buildCustomTask('rake', ['db:reset'])).toMatchObject({ tool: 'rake', args: ['db:reset'] })
    expect(buildCustomTask('bash', ['-c', 'x'])).toBeUndefined()
    expect(buildCustomTask('rails', ['db:migrate', 5 as unknown as string])?.args).toEqual(['db:migrate'])
  })
})

describe('manifest', () => {
  it('declares the railsforge task definition', () => {
    expect(manifest.contributes.taskDefinitions.map(t => t.type)).toContain('railsforge')
  })

  it('RuboCop emacs-format matcher extracts file/line/column/message', () => {
    const { re, p } = matcher('rubocop-railsforge')
    const m = re.exec('app/models/user.rb:12:5: C: [Correctable] Style/StringLiterals: Prefer single quotes')!
    expect(m[p.file]).toBe('app/models/user.rb')
    expect(m[p.line]).toBe('12')
    expect(m[p.column!]).toBe('5')
    expect(m[p.message]).toBe('Style/StringLiterals: Prefer single quotes')
  })

  it('RSpec matcher reads the "rspec ./path:line # description" failure summary', () => {
    const { re, p } = matcher('rspec-railsforge')
    const m = re.exec('rspec ./spec/models/user_spec.rb:7 # User is valid')!
    expect(m[p.file]).toBe('./spec/models/user_spec.rb')
    expect(m[p.line]).toBe('7')
    expect(m[p.message]).toBe('User is valid')
  })

  it('Minitest matcher reads "Class#test [file:line]:" headers', () => {
    const { re, p } = matcher('minitest-railsforge')
    const m = re.exec('UserTest#test_valid [test/models/user_test.rb:5]:')!
    expect(m[p.message]).toBe('UserTest#test_valid')
    expect(m[p.file]).toBe('test/models/user_test.rb')
    expect(m[p.line]).toBe('5')
  })
})
