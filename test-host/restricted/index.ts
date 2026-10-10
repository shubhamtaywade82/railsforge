/**
 * Restricted Mode, in a real VS Code. Run by scripts/restricted-host-test.mjs with workspace trust ENABLED
 * (test-electron always passes --disable-workspace-trust, so this suite launches VS Code itself).
 *
 * The workspace contains fake `bundle`, `rubocop`, `rake`, ... executables that drop a marker file when run.
 *   untrusted: read-only features work, and driving every executing command leaves NO marker;
 *   trusted (control, RAILSFORGE_EXPECT_TRUSTED=1): the same commands DO run the shims, so the absence of
 *   markers above is evidence of the gate, not of a broken harness.
 */
import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

const EXTENSION_ID = 'ShubhamTaywade.railsforge'
const expectTrusted = process.env.RAILSFORGE_EXPECT_TRUSTED === '1'
const markerDir = process.env.RAILSFORGE_SHIM_MARKERS ?? ''

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
const markers = (): string[] => (fs.existsSync(markerDir) ? fs.readdirSync(markerDir).sort() : [])

/** Runs a command, never failing the suite on its error, and never waiting on a VS Code dialog that tests auto-refuse. */
async function tolerate(what: string, fn: () => Thenable<unknown> | unknown): Promise<void> {
  try {
    const outcome = await Promise.race([Promise.resolve(fn()).then(() => 'done'), sleep(8000).then(() => 'timeout')])
    if (outcome === 'timeout') {console.log(`    (${what}: still waiting after 8s — moving on)`)}
  } catch (err) {
    console.log(`    (${what}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)})`)
  }
}

const step = (message: string): void => console.log(`[restricted-test] ${message}`)

export async function run(): Promise<void> {
  step(`started (expect trusted: ${expectTrusted})`)
  assert.ok(markerDir, 'RAILSFORGE_SHIM_MARKERS not set — run via scripts/restricted-host-test.mjs')
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  assert.ok(root, 'no workspace folder')

  // Precondition: the harness really produced the mode we think it did.
  assert.strictEqual(vscode.workspace.isTrusted, expectTrusted, `expected isTrusted=${expectTrusted} (did the trust settings apply?)`)

  step(`isTrusted = ${vscode.workspace.isTrusted}`)
  const ext = vscode.extensions.getExtension(EXTENSION_ID)
  assert.ok(ext, 'extension not found')
  await ext.activate()
  step('extension activated')
  assert.ok(ext.isActive, 'extension must activate in Restricted Mode (untrustedWorkspaces: limited)')
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(root, 'app', 'models', 'alphas.rb')))
  await sleep(500)

  step('opened a model file')
  // --- read-only features keep working in both modes -----------------------------------------------------
  await vscode.commands.executeCommand('railsforge.openVirtualDoc', 'schema')
  const schema = vscode.window.activeTextEditor?.document.getText() ?? ''
  assert.ok(schema.includes('alphas'), `schema document should render in any trust state:\n${schema.slice(0, 200)}`)

  await vscode.commands.executeCommand('railsforge.openPattern', 'service-object')
  assert.ok((vscode.window.activeTextEditor?.document.getText() ?? '').startsWith('# Service Object'), 'pattern explanations are read-only and must work')

  await vscode.commands.executeCommand('railsforge.diagnoseEnvironment')
  const diagnostics = vscode.window.activeTextEditor?.document.getText() ?? ''
  assert.ok(diagnostics.startsWith('# RailsForge diagnostics'))
  assert.strictEqual(diagnostics.includes('Restricted Mode'), !expectTrusted, 'diagnostics must say Restricted Mode exactly when untrusted')

  const lm = (vscode as unknown as { lm?: { tools: Array<{ name: string }>; invokeTool(name: string, options: { input: object; toolInvocationToken: undefined }): Thenable<{ content: Array<{ value?: string }> }> } }).lm
  if (lm?.tools) {
    const result = await lm.invokeTool('railsforge_get_schema', { input: {}, toolInvocationToken: undefined })
    assert.ok(result.content.map(p => p.value ?? '').join('').includes('alphas'), 'read-only LM tools must work in Restricted Mode')
  }

  step('read-only features OK')
  // --- executing features: refused when untrusted, live when trusted -----------------------------------
  // In Restricted Mode VS Code's own task service may never answer (it waits for trust); that is also "no tasks".
  const tasks = await Promise.race([vscode.tasks.fetchTasks({ type: 'railsforge' }), sleep(5000).then(() => undefined)])
  if (tasks === undefined) {
    assert.strictEqual(expectTrusted, false, 'the task service stalled although the workspace is trusted')
    step('task service waits for trust (VS Code-level block)')
  } else {
    assert.strictEqual(tasks.length > 0, expectTrusted, `task provider should offer tasks only when trusted (got ${tasks.length})`)
  }

  const terminalsBefore = vscode.window.terminals.length
  const drive: Array<[string, () => Thenable<unknown> | unknown]> = [
    ['rake tasks', () => vscode.commands.executeCommand('railsforge.refreshRakeTasks')],
    ['brakeman', () => vscode.commands.executeCommand('railsforge.runBrakeman')],
    ['bundle-audit', () => vscode.commands.executeCommand('railsforge.runBundleAudit')],
    ['rubocop autocorrect', () => vscode.commands.executeCommand('railsforge.rubocopAutocorrect')],
    ['steep', () => vscode.commands.executeCommand('railsforge.runSteepCheck')],
    ['save (lint/autocorrect hooks)', async () => {
      const doc = await vscode.workspace.openTextDocument(path.join(root, 'app', 'models', 'alphas.rb'))
      const active = await vscode.window.showTextDocument(doc)
      await active.edit(b => b.insert(new vscode.Position(0, 0), '# touched\n'))
      await doc.save()
    }],
  ]
  for (const [what, fn] of drive) {
    step(`driving: ${what}`)
    await tolerate(what, fn)
    await sleep(700)
  }
  await tolerate('open console', () => vscode.commands.executeCommand('railsforge.openRailsConsole'))
  await sleep(700)
  await tolerate('run all tests', () => vscode.commands.executeCommand('testing.runAll'))
  await sleep(1500)

  const ran = markers()
  console.log(`    shims that ran: ${ran.join(', ') || '(none)'}`)
  if (expectTrusted) {
    for (const expected of ['brakeman', 'bundle-audit', 'rubocop', 'steep']) {
      assert.ok(ran.includes(expected), `control run: ${expected} should have run when trusted — the shim harness is not reaching the extension (ran: ${ran.join(', ') || 'none'})`)
    }
  } else {
    assert.deepStrictEqual(ran, [], `Restricted Mode must not execute anything, but these ran: ${ran.join(', ')}`)
    assert.strictEqual(vscode.window.terminals.length, terminalsBefore, 'no terminal may be opened in Restricted Mode')
  }
}
