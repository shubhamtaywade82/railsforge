/**
 * RakeTaskIndexer - Lists Rake tasks via `rake -T`, verified against a real Rakefile
 * before writing the parser: task lines look like `rake db:migrate   # Migrate the
 * database` (column-padded, namespaced task names, no internal whitespace even for a
 * parameterized task like `greet[name]`), and an existing task with no `desc` simply
 * doesn't appear in `-T` output — Rake filters those out itself, so there's no "no
 * description" case to special-case here.
 *
 * Same `execFile` + `bundle exec X` (fall back to bare `X`) pattern as
 * RuboCopProvider/BrakemanProvider — never throws, degrades to an empty task list.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { firstCandidate } from '../util/RubyCommand'

const execFileAsync = promisify(execFile)

export interface RakeTask {
  name: string
  namespace: string | null
  description: string
}

const TASK_LINE = /^rake\s+(\S+)\s*#\s?(.*)$/

export function parseRakeTaskList(stdout: string): RakeTask[] {
  const tasks: RakeTask[] = []
  for (const line of stdout.split('\n')) {
    const match = TASK_LINE.exec(line)
    if (!match) {continue}
    const [, name, description] = match
    const colonIndex = name.indexOf(':')
    tasks.push({ name, namespace: colonIndex === -1 ? null : name.slice(0, colonIndex), description })
  }
  return tasks
}

export class RakeTaskIndexer {
  async listTasks(workspaceRoot: string): Promise<RakeTask[]> {
    return (await firstCandidate(workspaceRoot, 'rake', ['-T'], (cmd, args) => this.tryRake(cmd, args, workspaceRoot))) ?? []
  }

  private async tryRake(command: string, args: string[], cwd: string): Promise<RakeTask[] | null> {
    try {
      const { stdout } = await execFileAsync(command, args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 15000 })
      return parseRakeTaskList(stdout)
    } catch {
      return null
    }
  }
}
