/**
 * TestExplorerController - VS Code Native Test Explorer API Integration
 */

import * as vscode from 'vscode'
import { activeWorkspaceRoot } from '../workspace/activeRoot'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export class TestExplorerController {
  private testController: vscode.TestController

  constructor() {
    this.testController = vscode.tests.createTestController('railsforge.tests', 'RailsForge Tests')
    this.testController.createRunProfile(
      'Run',
      vscode.TestRunProfileKind.Run,
      (request, token) => this.runHandler(request, token),
      true,
    )
  }

  getController(): vscode.TestController {
    return this.testController
  }

  discoverTestsInDocument(document: vscode.TextDocument): void {
    if (!document.fileName.endsWith('_spec.rb') && !document.fileName.endsWith('_test.rb')) {
      return
    }

    const fileTest = this.testController.createTestItem(
      document.uri.toString(),
      vscode.workspace.asRelativePath(document.uri),
      document.uri,
    )

    const lines = document.getText().split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const match = /^\s*(?:it|scenario|specify|test)\s+["']([^"']+)["']/.exec(line)
      if (match) {
        const item = this.testController.createTestItem(
          `${document.uri.toString()}:${i + 1}`,
          match[1],
          document.uri,
        )
        item.range = new vscode.Range(i, 0, i, line.length)
        fileTest.children.add(item)
      }
    }

    this.testController.items.add(fileTest)
  }

  private async runHandler(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
    const run = this.testController.createTestRun(request)
    const queue: vscode.TestItem[] = []

    if (request.include) {
      queue.push(...request.include)
    } else {
      this.testController.items.forEach(item => queue.push(item))
    }

    // Each test's result must be recorded before `run.end()` fires — VS Code's Test API
    // treats state updates after `end()` as undefined behavior, and the previous
    // fire-and-forget `execFile` callbacks routinely lost that race, leaving the Test
    // Explorer UI showing tests as perpetually running.
    const runs = queue.map(async test => {
      if (token.isCancellationRequested) {return}
      run.started(test)

      // execFile (not exec/a shell string) so the file path — which can contain
      // arbitrary characters in an untrusted workspace — is never interpreted by a shell.
      const [command, args] = this.buildTestCommand(test)
      try {
        await execFileAsync(command, args, { cwd: activeWorkspaceRoot() })
        run.passed(test)
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string }
        run.failed(test, new vscode.TestMessage(execErr.stderr || execErr.stdout || execErr.message || 'Test failed'))
      }
    })

    await Promise.all(runs)
    run.end()
  }

  private buildTestCommand(item: vscode.TestItem): [string, string[]] {
    const uri = item.uri?.fsPath ?? ''
    const isRSpec = uri.includes('/spec/')
    const target = item.range ? `${uri}:${item.range.start.line + 1}` : uri

    return isRSpec
      ? ['bundle', ['exec', 'rspec', target]]
      : ['bundle', ['exec', 'rails', 'test', target]]
  }

  dispose(): void {
    this.testController.dispose()
  }
}
