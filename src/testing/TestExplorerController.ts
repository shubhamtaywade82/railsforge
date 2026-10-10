/**
 * TestExplorerController - VS Code Native Test Explorer integration for RSpec and Minitest.
 *
 * - Discovery: workspace-wide (file watcher + on-open), nested describe/context/it and
 *   Minitest classes/tests (see TestDiscovery).
 * - Run: one invocation per file (RSpec `--format json`, Minitest text output) mapped to
 *   per-test pass/fail/skip, durations and failure locations; streams raw output; cancellable.
 * - Debug: launches the Ruby `rdbg` extension with the same resolved command (terminal
 *   fallback when it is not installed).
 */

import * as vscode from 'vscode'
import { createProjectTerminal, sendToTerminal, startProjectDebugging } from '../workspace/ProjectTerminal'
import { isWorkspaceTrusted } from '../workspace/Trust'
import * as path from 'path'
import { execFileAsync } from '../util/ProjectProcess'
import { activeWorkspaceRoot, workspaceRootFor } from '../workspace/activeRoot'
import { rubyCandidates } from '../util/RubyCommand'
import { buildExcludeGlob, readConfig } from '../config/RailsForgeConfig'
import { Logger } from '../util/Logger'
import { TestFramework, TestNode, frameworkForPath, parseTestStructure } from './TestDiscovery'
import { parseMinitestOutput, parseRspecJson } from './TestResultParsers'
import { LeafRef, Outcome, mapMinitestOutcomes, mapRspecOutcomes } from './TestOutcomeMapper'
import { RDBG_EXTENSION_ID, buildRdbgLaunchConfig } from './RdbgConfig'

const TEST_GLOB = '**/*_{spec,test}.rb'
const ALWAYS_EXCLUDED = ['**/node_modules/**', '**/vendor/**', '**/.git/**']

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

export class TestExplorerController implements vscode.Disposable {
  private readonly testController: vscode.TestController
  private readonly disposables: vscode.Disposable[] = []
  /** TestItem id -> declaration line (0-based), used when mapping results back. */
  private readonly lineOf = new Map<string, number>()

  constructor() {
    this.testController = vscode.tests.createTestController('railsforge.tests', 'RailsForge Tests')
    this.testController.createRunProfile('Run', vscode.TestRunProfileKind.Run, (req, token) => this.runHandler(req, token), true)
    this.testController.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, (req, token) => this.debugHandler(req, token), false)
    this.testController.resolveHandler = async item => {
      if (!item) {await this.discoverWorkspace()}
    }
    this.testController.refreshHandler = () => this.discoverWorkspace()
    this.watch()
  }

  getController(): vscode.TestController {
    return this.testController
  }

  // ---- discovery ----------------------------------------------------------------------

  private watch(): void {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${TEST_GLOB}`)
    const reload = (uri: vscode.Uri): void => { void this.discoverFile(uri) }
    watcher.onDidCreate(reload)
    watcher.onDidChange(reload)
    watcher.onDidDelete(uri => this.testController.items.delete(uri.toString()))
    this.disposables.push(watcher)
  }

  async discoverWorkspace(): Promise<void> {
    const exclude = buildExcludeGlob([...readConfig().excludePatterns, ...ALWAYS_EXCLUDED]) ?? undefined
    const files = await vscode.workspace.findFiles(TEST_GLOB, exclude)
    await Promise.all(files.map(uri => this.discoverFile(uri)))
  }

  private async discoverFile(uri: vscode.Uri): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri)
      this.populateFile(uri, Buffer.from(bytes).toString('utf8'))
    } catch (err) {
      Logger.debug(`[tests] could not read ${uri.fsPath}: ${String(err)}`)
    }
  }

  /** Re-parses an open document (unsaved edits included). */
  discoverTestsInDocument(document: vscode.TextDocument): void {
    this.populateFile(document.uri, document.getText())
  }

  private populateFile(uri: vscode.Uri, text: string): void {
    const framework = frameworkForPath(uri.fsPath)
    if (!framework) {return}

    const id = uri.toString()
    let fileItem = this.testController.items.get(id)
    if (!fileItem) {
      fileItem = this.testController.createTestItem(id, vscode.workspace.asRelativePath(uri), uri)
      this.testController.items.add(fileItem)
    }
    fileItem.canResolveChildren = false

    const children = this.buildItems(uri, parseTestStructure(text, framework))
    fileItem.children.replace(children)
  }

  private buildItems(uri: vscode.Uri, nodes: readonly TestNode[]): vscode.TestItem[] {
    return nodes.map(node => {
      const id = `${uri.toString()}::${node.line}`
      const item = this.testController.createTestItem(id, node.name, uri)
      item.range = new vscode.Range(node.line, 0, node.line, 0)
      this.lineOf.set(id, node.line)
      if (node.kind === 'group') {item.children.replace(this.buildItems(uri, node.children))}
      return item
    })
  }

  // ---- run ----------------------------------------------------------------------------

  private fileItemOf(item: vscode.TestItem): vscode.TestItem {
    let current = item
    while (current.parent) {current = current.parent}
    return current
  }

  private collectLeaves(item: vscode.TestItem, excluded: ReadonlySet<string>): vscode.TestItem[] {
    if (excluded.has(item.id)) {return []}
    if (item.children.size === 0) {return item.parent ? [item] : []}
    const out: vscode.TestItem[] = []
    item.children.forEach(child => out.push(...this.collectLeaves(child, excluded)))
    return out
  }

  /** Groups the requested items by file; a file-level request (or an excluded-free file) runs whole. */
  private planFiles(request: vscode.TestRunRequest): Map<vscode.TestItem, { whole: boolean; selected: vscode.TestItem[] }> {
    const plan = new Map<vscode.TestItem, { whole: boolean; selected: vscode.TestItem[] }>()
    const include: vscode.TestItem[] = []
    if (request.include) {include.push(...request.include)} else {this.testController.items.forEach(i => include.push(i))}
    for (const item of include) {
      const file = this.fileItemOf(item)
      const entry = plan.get(file) ?? { whole: false, selected: [] }
      if (item === file) {entry.whole = true} else {entry.selected.push(item)}
      plan.set(file, entry)
    }
    return plan
  }

  /** Running tests executes project code; in Restricted Mode say so in the test output and stop. */
  private refuseUntrusted(run: vscode.TestRun): boolean {
    if (isWorkspaceTrusted()) {return false}
    run.appendOutput('RailsForge: running tests executes project code, which is disabled in Restricted Mode. Trust this workspace to enable it.\r\n')
    run.end()
    return true
  }

  private async runHandler(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
    const run = this.testController.createTestRun(request)
    if (this.refuseUntrusted(run)) {return}
    const excluded = new Set((request.exclude ?? []).map(i => i.id))
    try {
      // Sequential: parallel test processes against one dev database collide.
      for (const [fileItem, entry] of this.planFiles(request)) {
        if (token.isCancellationRequested) {break}
        await this.runFile(run, fileItem, entry, excluded, token)
      }
    } finally {
      run.end()
    }
  }

  private async runFile(
    run: vscode.TestRun,
    fileItem: vscode.TestItem,
    entry: { whole: boolean; selected: vscode.TestItem[] },
    excluded: ReadonlySet<string>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const uri = fileItem.uri
    const framework = uri ? frameworkForPath(uri.fsPath) : undefined
    if (!uri || !framework) {return}

    const scope = entry.whole ? [fileItem] : entry.selected
    const leaves = [...new Set(scope.flatMap(i => this.collectLeaves(i, excluded)))]
    if (leaves.length === 0) {return}
    leaves.forEach(l => run.started(l))

    const root = workspaceRootFor(uri) ?? activeWorkspaceRoot() ?? path.dirname(uri.fsPath)
    const targets = this.targetsFor(uri, framework, entry.whole ? [] : scope)
    const { tool, args } = this.invocation(framework, targets)

    const result = await this.exec(root, tool, args, token)
    if (token.isCancellationRequested) {
      leaves.forEach(l => run.skipped(l))
      return
    }
    run.appendOutput(`$ ${tool} ${args.join(' ')}\r\n${(result.stdout + result.stderr).replace(/\r?\n/g, '\r\n')}\r\n`, undefined, fileItem)

    const refs: LeafRef[] = leaves.map(l => ({ id: l.id, name: l.label, line: this.lineOf.get(l.id) ?? l.range?.start.line ?? 0 }))
    const raw = result.stdout + result.stderr
    const outcomes = framework === 'rspec'
      ? mapRspecOutcomes(refs, parseRspecJson(result.stdout), result.exitCode, raw)
      : mapMinitestOutcomes(refs, parseMinitestOutput(raw).failures, result.exitCode, raw)

    for (const leaf of leaves) {
      this.report(run, leaf, uri, outcomes.get(leaf.id) ?? { status: 'errored', message: 'No outcome' })
    }
  }

  private report(run: vscode.TestRun, leaf: vscode.TestItem, uri: vscode.Uri, outcome: Outcome): void {
    switch (outcome.status) {
      case 'passed': run.passed(leaf, outcome.durationMs); break
      case 'skipped': run.skipped(leaf); break
      case 'failed': {
        const message = new vscode.TestMessage(outcome.message)
        const line = (outcome.line ?? (this.lineOf.get(leaf.id) ?? 0) + 1) - 1
        message.location = new vscode.Location(uri, new vscode.Position(Math.max(0, line), 0))
        run.failed(leaf, message, outcome.durationMs)
        break
      }
      case 'errored': run.errored(leaf, new vscode.TestMessage(outcome.message)); break
    }
  }

  /** RSpec accepts several `file:line` targets; Minitest runs the whole file unless exactly one item is selected. */
  private targetsFor(uri: vscode.Uri, framework: TestFramework, selected: readonly vscode.TestItem[]): string[] {
    if (selected.length === 0) {return [uri.fsPath]}
    const lineTarget = (item: vscode.TestItem): string => `${uri.fsPath}:${(this.lineOf.get(item.id) ?? 0) + 1}`
    if (framework === 'rspec') {return selected.map(lineTarget)}
    return selected.length === 1 ? [lineTarget(selected[0])] : [uri.fsPath]
  }

  private invocation(framework: TestFramework, targets: string[]): { tool: string; args: string[] } {
    if (framework === 'rspec') {return { tool: 'rspec', args: ['--format', 'json', ...targets] }}
    return { tool: 'rails', args: ['test', ...targets] }
  }

  /** Runs through the project toolchain; ENOENT falls through to the next candidate, a non-zero exit is a result. */
  private async exec(root: string, tool: string, args: string[], token: vscode.CancellationToken): Promise<ExecResult> {
    const abort = new AbortController()
    const sub = token.onCancellationRequested(() => abort.abort())
    try {
      for (const c of rubyCandidates(root, tool, args)) {
        try {
          const { stdout, stderr } = await execFileAsync(c.command, c.args, { cwd: root, maxBuffer: 50 * 1024 * 1024, signal: abort.signal })
          return { exitCode: 0, stdout, stderr }
        } catch (err: unknown) {
          const e = err as { code?: string | number; stdout?: string; stderr?: string; message?: string; name?: string }
          if (e.code === 'ENOENT') {continue}
          if (e.name === 'AbortError' || e.code === 'ABORT_ERR') {return { exitCode: 1, stdout: '', stderr: 'cancelled' }}
          return { exitCode: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '' }
        }
      }
      return { exitCode: 127, stdout: '', stderr: `Could not launch \`${tool}\` (no binstub, bundler or executable found).` }
    } finally {
      sub.dispose()
    }
  }

  // ---- debug --------------------------------------------------------------------------

  private async debugHandler(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
    const run = this.testController.createTestRun(request)
    if (this.refuseUntrusted(run)) {return}
    try {
      const [first] = request.include ?? []
      const item = first ?? (() => { let any: vscode.TestItem | undefined; this.testController.items.forEach(i => { any ??= i }); return any })()
      const uri = item?.uri
      if (!item || !uri || token.isCancellationRequested) {return}
      const framework = frameworkForPath(uri.fsPath)
      if (!framework) {return}

      const targets = item.parent ? this.targetsFor(uri, framework, [item]) : [uri.fsPath]
      const { tool, args } = framework === 'rspec' ? { tool: 'rspec', args: targets } : { tool: 'rails', args: ['test', ...targets] }
      await debugRubyCommand(uri, tool, args)
      run.appendOutput('Debug session started via rdbg — results appear in the Debug Console.\r\n')
    } finally {
      run.end()
    }
  }

  dispose(): void {
    for (const d of this.disposables) {d.dispose()}
    this.testController.dispose()
  }
}

/**
 * Debugs `tool args…` for the project owning `uri` through the Ruby rdbg extension; when it
 * isn't installed, falls back to an `rdbg -n -c --` terminal and says how to get the full experience.
 */
export async function debugRubyCommand(uri: vscode.Uri, tool: string, args: string[]): Promise<void> {
  const root = workspaceRootFor(uri) ?? path.dirname(uri.fsPath)
  const [command] = rubyCandidates(root, tool, args)

  if (vscode.extensions.getExtension(RDBG_EXTENSION_ID)) {
    const folder = vscode.workspace.getWorkspaceFolder(uri)
    const config = buildRdbgLaunchConfig(`RailsForge: debug ${path.basename(uri.fsPath)}`, root, command.command, command.args)
    const started = await startProjectDebugging(folder, config)
    if (started) {return}
    vscode.window.showWarningMessage('RailsForge: the rdbg debug session did not start; falling back to a terminal.')
  } else {
    const choice = await vscode.window.showInformationMessage(
      'Install the "Ruby Debugger" (rdbg) extension to debug tests with breakpoints. Running in a terminal instead.',
      'Install',
    )
    if (choice === 'Install') {void vscode.commands.executeCommand('workbench.extensions.installExtension', RDBG_EXTENSION_ID)}
  }
  const terminal = createProjectTerminal({ name: 'RailsForge rdbg', cwd: root })
  terminal.show()
  sendToTerminal(terminal, `rdbg -n -c -- ${[command.command, ...command.args].map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`)
}
