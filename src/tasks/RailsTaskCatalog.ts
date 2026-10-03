/**
 * RailsTaskCatalog - pure description of the tasks RailsForge offers through VS Code's
 * Task system (`type: "railsforge"`). The vscode-facing provider turns these into Task objects.
 */

export interface RailsTaskSpec {
  /** Stable id used in tasks.json: { "type": "railsforge", "task": "<id>" }. */
  id: string
  label: string
  tool: string
  args: string[]
  group?: 'test' | 'build'
  isDefaultGroup?: boolean
  problemMatchers: string[]
  /** Only offered for Rails applications. */
  railsOnly?: boolean
}

export interface CatalogInput {
  isRails: boolean
  testFramework: 'rspec' | 'minitest'
  hasBrakeman: boolean
}

export const PROBLEM_MATCHER_RUBOCOP = '$rubocop-railsforge'
export const PROBLEM_MATCHER_RSPEC = '$rspec-railsforge'
export const PROBLEM_MATCHER_MINITEST = '$minitest-railsforge'

export function buildTaskCatalog(input: CatalogInput): RailsTaskSpec[] {
  const tasks: RailsTaskSpec[] = []

  if (input.testFramework === 'rspec') {
    tasks.push({ id: 'test', label: 'RSpec: run all', tool: 'rspec', args: [], group: 'test', isDefaultGroup: true, problemMatchers: [PROBLEM_MATCHER_RSPEC] })
  } else if (input.isRails) {
    tasks.push({ id: 'test', label: 'Rails test: run all', tool: 'rails', args: ['test'], group: 'test', isDefaultGroup: true, problemMatchers: [PROBLEM_MATCHER_MINITEST] })
  } else {
    tasks.push({ id: 'test', label: 'Minitest: rake test', tool: 'rake', args: ['test'], group: 'test', isDefaultGroup: true, problemMatchers: [PROBLEM_MATCHER_MINITEST] })
  }

  tasks.push({ id: 'rubocop', label: 'RuboCop: lint', tool: 'rubocop', args: ['--format', 'emacs'], group: 'build', problemMatchers: [PROBLEM_MATCHER_RUBOCOP] })

  if (input.hasBrakeman) {
    tasks.push({ id: 'brakeman', label: 'Brakeman: security scan', tool: 'brakeman', args: ['-q', '--no-pager'], problemMatchers: [] })
  }

  if (input.isRails) {
    tasks.push(
      { id: 'db:migrate', label: 'Rails: db:migrate', tool: 'rails', args: ['db:migrate'], problemMatchers: [], railsOnly: true },
      { id: 'db:rollback', label: 'Rails: db:rollback', tool: 'rails', args: ['db:rollback'], problemMatchers: [], railsOnly: true },
      { id: 'db:prepare', label: 'Rails: db:prepare', tool: 'rails', args: ['db:prepare'], problemMatchers: [], railsOnly: true },
      { id: 'db:seed', label: 'Rails: db:seed', tool: 'rails', args: ['db:seed'], problemMatchers: [], railsOnly: true },
      { id: 'routes', label: 'Rails: routes', tool: 'rails', args: ['routes'], problemMatchers: [], railsOnly: true },
    )
  }
  return tasks
}

/** Argument-safe custom task: { "task": "rake", "args": ["db:reset"] } or { "task": "rails", "args": [...] }. */
export function buildCustomTask(task: string, args: readonly string[] | undefined): RailsTaskSpec | undefined {
  if (task !== 'rake' && task !== 'rails' && task !== 'rspec' && task !== 'rubocop') {return undefined}
  const safeArgs = (args ?? []).filter((a): a is string => typeof a === 'string')
  return {
    id: task,
    label: `${task} ${safeArgs.join(' ')}`.trim(),
    tool: task,
    args: safeArgs,
    problemMatchers: task === 'rspec' ? [PROBLEM_MATCHER_RSPEC] : task === 'rubocop' ? [PROBLEM_MATCHER_RUBOCOP] : [],
  }
}
