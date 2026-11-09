/**
 * AdapterUi - the IDE side of the optional tools: the prompt for an enabled tool that is missing, the status list,
 * and the install flow.
 *
 * The install flow never runs a command. It puts the command on a RailsForge terminal line without the newline, so
 * the user reads it and presses Enter. In an untrusted workspace it only offers to copy the command.
 */

import * as vscode from 'vscode'
import { AdapterEntry, AdapterId, InstallPlan, isAdapterId } from './AdapterCatalog'
import { AdapterReport, reportAdapters } from './AdapterService'
import { AdapterState, describeState, shouldPromptForMissing } from './AdapterStatus'
import { createProjectTerminal, sendToTerminal } from '../workspace/ProjectTerminal'
import { isWorkspaceTrusted } from '../workspace/Trust'
import { Logger } from '../util/Logger'

const promptedThisSession = new Set<AdapterId>()

export function dismissalKey(id: AdapterId): string {
  return `railsforge.adapters.dismissed.${id}`
}

/** Only a tool the check found absent is offered for install. A missing toolchain means the check never ran. */
export function isMissing(state: AdapterState): boolean {
  return state.kind === 'missing'
}

function scopeText(plan: InstallPlan): string {
  return plan.scope === 'project' ? 'changes this application' : 'outside this application'
}

/** Asks once per session about an enabled tool that is missing, unless the user chose "Don't ask" for this workspace. */
export async function promptIfMissing(input: {
  report: AdapterReport
  root: string
  memory: vscode.Memento
  enabled: boolean
  promptWhenMissing: boolean
}): Promise<void> {
  const { report, root, memory } = input
  const dismissed = memory.get<boolean>(dismissalKey(report.entry.id), false) || promptedThisSession.has(report.entry.id)
  const eligible = shouldPromptForMissing({
    enabled: input.enabled,
    promptWhenMissing: input.promptWhenMissing,
    dismissed,
    state: report.state,
  })
  if (!eligible) {return}
  promptedThisSession.add(report.entry.id)

  const choice = await vscode.window.showInformationMessage(
    `RailsForge can use ${report.entry.label}, which is not installed. ${report.entry.summary}`,
    'Install…',
    'Details',
    'Not now',
    "Don't ask in this workspace",
  )
  if (choice === 'Install…') {return installAdapter(report.entry, root)}
  if (choice === 'Details') {return showDetails(report.entry, report.state)}
  if (choice === "Don't ask in this workspace") {await memory.update(dismissalKey(report.entry.id), true)}
}

export async function installAdapter(entry: AdapterEntry, root: string): Promise<void> {
  const plan = await choosePlan(entry)
  if (!plan) {return}
  const command = plan.steps.join(' && ')

  if (!isWorkspaceTrusted()) {
    const copied = await vscode.window.showWarningMessage(
      `Trust this workspace to open a terminal for the install. Until then, you can copy the command: ${command}`,
      'Copy command',
    )
    if (copied) {await vscode.env.clipboard.writeText(command)}
    return
  }

  // No newline: the command appears on the terminal line, and the user presses Enter to run it.
  const terminal = createProjectTerminal({ name: `RailsForge: install ${entry.label}`, cwd: root })
  sendToTerminal(terminal, command, false)
  terminal.show()
}

async function choosePlan(entry: AdapterEntry): Promise<InstallPlan | undefined> {
  if (entry.installs.length === 1) {return entry.installs[0]}
  const picked = await vscode.window.showQuickPick(
    entry.installs.map(plan => ({ label: plan.label, description: scopeText(plan), plan })),
    { placeHolder: `How should ${entry.label} be installed?` },
  )
  return picked?.plan
}

export async function showDetails(entry: AdapterEntry, state: AdapterState): Promise<void> {
  const lines = [
    `# ${entry.label}`,
    '',
    entry.summary,
    '',
    `**Status:** ${describeState(state)}`,
    '',
    '## Install',
    '',
    ...entry.installs.flatMap(plan => [`**${plan.label}** (${scopeText(plan)}):`, '', '```sh', ...plan.steps, '```', '']),
    '## Requirements',
    '',
    entry.minimumRuby ? `- Ruby ${entry.minimumRuby} or newer (${entry.requirementSource}).` : `- Ruby: none stated (${entry.requirementSource}).`,
    ...(entry.minimumNode ? [`- Node ${entry.minimumNode} or newer.`] : []),
    '',
    '## Notes',
    '',
    ...entry.notes.map(note => `- ${note}`),
    '',
    'RailsForge never runs these commands by itself. Install from RailsForge to open a terminal with the command. Review it, then press Enter.',
  ]
  const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' })
  await vscode.window.showTextDocument(doc, { preview: true })
}

export async function showStatus(root: string): Promise<void> {
  const reports = await reportAdapters(root)
  const picked = await vscode.window.showQuickPick(
    reports.map(report => ({ label: report.entry.label, description: describeState(report.state), report })),
    { placeHolder: 'Optional tools RailsForge can use. Choose one for details, or to install it.' },
  )
  if (!picked) {return}
  if (isMissing(picked.report.state)) {return installAdapter(picked.report.entry, root)}
  return showDetails(picked.report.entry, picked.report.state)
}

export function registerAdapterCommands(rootOf: () => string | undefined): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('railsforge.adapters.status', async () => {
      const root = rootOf()
      if (root) {await showStatus(root)}
    }),
    vscode.commands.registerCommand('railsforge.adapters.install', async () => {
      const root = rootOf()
      if (!root) {return}
      const missing = (await reportAdapters(root)).filter(report => isMissing(report.state))
      if (missing.length === 0) {
        void vscode.window.showInformationMessage('RailsForge: no optional tool is known to be missing.')
        return
      }
      const picked = await vscode.window.showQuickPick(
        missing.map(report => ({ label: report.entry.label, description: report.entry.summary, entry: report.entry })),
        { placeHolder: 'Install an optional tool' },
      )
      if (picked) {await installAdapter(picked.entry, root)}
    }),
  ]
}

/**
 * Runs at activation, unawaited. Probes and prompts only for the tools the user enabled in settings. It never
 * rejects: a failure is logged, and activation carries on without the prompt.
 */
export async function checkEnabledAdapters(memory: vscode.Memento, root: string): Promise<void> {
  try {
    const config = vscode.workspace.getConfiguration('railsForge')
    const enabled = (config.get<string[]>('adapters.enabled', []) ?? []).filter(isAdapterId)
    if (enabled.length === 0) {return}
    const promptWhenMissing = config.get<boolean>('adapters.promptWhenMissing', true)
    const reports = await reportAdapters(root, enabled)
    for (const report of reports) {
      await promptIfMissing({ report, root, memory, enabled: true, promptWhenMissing })
    }
  } catch (err) {
    Logger.warn(`[adapters] enabled-tool check failed: ${String(err)}`)
  }
}
