/**
 * RailsTaskProvider - exposes tests, RuboCop, Brakeman and common Rails/DB commands as native
 * VS Code tasks (`type: "railsforge"`), executed without a shell (ProcessExecution) through the
 * project's Ruby toolchain, with problem matchers wired in so failures land in the Problems panel.
 */

import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { EnvironmentDetector } from '../environment/EnvironmentDetector'
import { rubyCandidates } from '../util/RubyCommand'
import { isWorkspaceTrusted } from '../workspace/Trust'
import { RailsTaskSpec, buildCustomTask, buildTaskCatalog } from './RailsTaskCatalog'

export const RAILSFORGE_TASK_TYPE = 'railsforge'

interface RailsForgeTaskDefinition extends vscode.TaskDefinition {
  task: string
  args?: string[]
}

export class RailsTaskProvider implements vscode.TaskProvider {
  private readonly detector = new EnvironmentDetector()

  provideTasks(): vscode.Task[] {
    // Tasks run project code; offer none in Restricted Mode (VS Code also refuses to run them).
    if (!isWorkspaceTrusted()) {return []}
    const tasks: vscode.Task[] = []
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const root = folder.uri.fsPath
      if (!fs.existsSync(path.join(root, 'Gemfile')) && !fs.existsSync(path.join(root, 'Rakefile'))) {continue}
      const env = this.detector.detectEnvironment(root)
      const catalog = buildTaskCatalog({
        isRails: env.hasRails,
        testFramework: env.testFramework,
        hasBrakeman: env.hasBrakeman,
      })
      for (const spec of catalog) {
        tasks.push(this.toTask(spec, folder, { type: RAILSFORGE_TASK_TYPE, task: spec.id }))
      }
    }
    return tasks
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    if (!isWorkspaceTrusted()) {return undefined}
    const def = task.definition as RailsForgeTaskDefinition
    const folder = typeof task.scope === 'object' && task.scope && 'uri' in task.scope
      ? task.scope as vscode.WorkspaceFolder
      : vscode.workspace.workspaceFolders?.[0]
    if (!folder || typeof def.task !== 'string') {return undefined}

    const preset = this.provideTasks().find(t => (t.definition as RailsForgeTaskDefinition).task === def.task && t.scope === folder)
    if (preset && !def.args) {return preset}

    const custom = buildCustomTask(def.task, def.args)
    return custom ? this.toTask(custom, folder, def) : undefined
  }

  private toTask(spec: RailsTaskSpec, folder: vscode.WorkspaceFolder, definition: vscode.TaskDefinition): vscode.Task {
    const root = folder.uri.fsPath
    const [command] = rubyCandidates(root, spec.tool, spec.args)
    const execution = new vscode.ProcessExecution(command.command, command.args, { cwd: root })
    const task = new vscode.Task(definition, folder, spec.label, 'RailsForge', execution, spec.problemMatchers)
    if (spec.group === 'test') {task.group = vscode.TaskGroup.Test}
    if (spec.group === 'build') {task.group = vscode.TaskGroup.Build}
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true }
    return task
  }
}
