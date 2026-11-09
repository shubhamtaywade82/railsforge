/**
 * RefactorAdvisorCommand - the VS Code half of the refactoring advisor.
 *
 *   Lightbulb on a class, method or selection  ->  railsforge.suggestRefactorings
 *     -> AI suggestions (Quick Pick)            ->  pick one
 *     -> the exact file changes, as native diffs ->  modal "Apply"
 *     -> RefactoringEditProvider.apply           (one WorkspaceEdit, undoable)
 *
 * Nothing is written before the user confirms in the modal. The change is also re-checked against
 * the open buffers at apply time: if a file changed while the preview was open, the apply is refused
 * and the user is told to run the suggestion again.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { Logger } from '../../util/Logger'
import { EditOperation, RefactoringEditProvider } from '../../providers/RefactoringEditProvider'
import { describeTarget, SelectionLines, TargetResolver } from './TargetResolver'
import { RefactorAdvisor } from './RefactorAdvisor'
import { AdvisorFailure, AdvisorResult, ProposedChange, RefactorSuggestion, SourceReader } from './types'

export const SUGGEST_REFACTORINGS_COMMAND = 'railsforge.suggestRefactorings'

/** Code action kind shown under the Refactor menu and the lightbulb. */
export const REFACTOR_ADVISOR_KIND = vscode.CodeActionKind.Refactor.append('railsforge.advisor')

/**
 * Offers "Suggest refactorings for <target>" on a Ruby file wherever the cursor or selection sits in
 * a class, module, method or a non-blank selection. Producing the action is free: no model call
 * happens until the user chooses it.
 */
export class RefactorSuggestionCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [REFACTOR_ADVISOR_KIND]

  constructor(private readonly resolver: TargetResolver) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    if (document.languageId !== 'ruby') {return []}
    const resolution = this.resolver.resolve(document.getText(), toSelectionLines(range))
    if (!resolution.ok) {return []}

    const label = describeTarget(resolution.target)
    const action = new vscode.CodeAction(`RailsForge: suggest refactorings for ${label}`, REFACTOR_ADVISOR_KIND)
    action.command = {
      command: SUGGEST_REFACTORINGS_COMMAND,
      title: `Suggest refactorings for ${label}`,
      arguments: [document.uri, range],
    }
    return [action]
  }
}

export interface RefactorAdvisorCommandDeps {
  advisor: RefactorAdvisor
  resolver: TargetResolver
  editProvider: RefactoringEditProvider
  /** Absolute path of the project the advisor's index and file reader are bound to. */
  projectRoot: () => string | undefined
}

interface SuggestionItem extends vscode.QuickPickItem {
  suggestion: RefactorSuggestion
}

export class RefactorAdvisorCommand {
  constructor(private readonly deps: RefactorAdvisorCommandDeps) {}

  /** Entry point for the command. Invoked from a code action (uri + range) or the palette (active editor). */
  async run(uriArg?: vscode.Uri, rangeArg?: vscode.Range | vscode.Selection): Promise<void> {
    const editor = vscode.window.activeTextEditor
    const uri = uriArg ?? editor?.document.uri
    const range = rangeArg ?? (uriArg ? undefined : editor?.selection)
    if (!uri || !range) {
      void vscode.window.showInformationMessage('RailsForge: open a Ruby file and put the cursor in a class, module or method first.')
      return
    }

    const root = this.deps.projectRoot()
    if (!root) {
      void vscode.window.showWarningMessage('RailsForge: open a Rails project folder first.')
      return
    }
    const document = await vscode.workspace.openTextDocument(uri)
    const relativePath = relativeTo(root, document.uri.fsPath)
    if (!relativePath) {
      void vscode.window.showWarningMessage('RailsForge: this file is outside the project the advisor is bound to.')
      return
    }

    const content = document.getText()
    const resolution = this.deps.resolver.resolve(content, toSelectionLines(range))
    if (!resolution.ok) {
      void vscode.window.showInformationMessage(`RailsForge: ${resolution.message}`)
      return
    }
    const target = resolution.target
    const label = describeTarget(target)

    try {
      const suggestions = await withProgress(`RailsForge: asking the AI about ${label}`, () =>
        this.deps.advisor.suggest({ relativePath, content, target }))
      if (!suggestions.ok) {
        this.report(suggestions)
        return
      }
      if (suggestions.value.length === 0) {
        void vscode.window.showInformationMessage(`RailsForge: no refactoring worth making in ${label}.`)
        return
      }

      const items: SuggestionItem[] = suggestions.value.map(suggestion => ({
        label: `$(lightbulb) ${suggestion.title}`,
        description: `${suggestion.pattern} · ${suggestion.impact} impact`,
        detail: `${suggestion.rationale}  (${suggestion.files.join(', ')})`,
        suggestion,
      }))
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Refactorings for ${label}: pick one to preview its changes`,
        matchOnDetail: true,
      })
      if (!picked) {return}

      await this.previewAndApply(picked.suggestion, root)
    } catch (err) {
      Logger.error(`[RefactorAdvisor] ${String(err)}`)
      void vscode.window.showErrorMessage(`RailsForge: the refactoring advisor failed: ${errorText(err)}`)
    }
  }

  private async previewAndApply(suggestion: RefactorSuggestion, root: string): Promise<void> {
    const plan = await withProgress(`RailsForge: preparing "${suggestion.title}"`, () => this.deps.advisor.plan(suggestion))
    if (!plan.ok) {
      this.report(plan)
      return
    }
    const { changes, syntaxUnverified } = plan.value

    for (const change of changes) {
      await openDiff(change, root)
    }

    const detail = changes.map(c => `${c.kind === 'create' ? 'new file' : 'changed'}: ${c.path}`).join('\n')
      + (syntaxUnverified ? '\n\nRuby is not installed, so the syntax check could not run.' : '')
    const choice = await vscode.window.showInformationMessage(
      `Apply "${suggestion.title}" to ${changes.length} file(s)?`,
      { modal: true, detail },
      'Apply',
    )
    if (choice !== 'Apply') {return}

    const stale = await staleChange(changes, root)
    if (stale) {
      void vscode.window.showWarningMessage(`RailsForge: ${stale} changed while the preview was open. Run the suggestion again.`)
      return
    }

    const ops = await toOperations(changes, root)
    const applied = await this.deps.editProvider.apply(ops, { label: suggestion.title })
    if (!applied) {
      void vscode.window.showWarningMessage('RailsForge: the change was not applied.')
      return
    }
    Logger.info(`[RefactorAdvisor] applied "${suggestion.title}" to ${changes.length} file(s)`)
    void vscode.window.showInformationMessage(`RailsForge: applied "${suggestion.title}" to ${changes.length} file(s). Review the changes before saving.`)
  }

  private report(failure: Extract<AdvisorResult<unknown>, { ok: false }>): void {
    Logger.warn(`[RefactorAdvisor] ${failure.reason}: ${failure.message}`)
    void vscode.window.showWarningMessage(`RailsForge: ${reasonHeadline(failure.reason)} ${truncate(failure.message, 300)}`)
  }
}

/** A buffer-first file reader bound to one project root. Open editors win over disk, so unsaved edits are what the model sees. */
export function vsCodeSourceReader(root: string): SourceReader {
  return {
    async read(relativePath: string): Promise<string | undefined> {
      const absolute = path.resolve(root, relativePath)
      const open = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && path.resolve(d.uri.fsPath) === absolute)
      if (open) {return open.getText()}
      try {
        return await fs.promises.readFile(absolute, 'utf8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {return undefined}
        throw err
      }
    },
  }
}

async function openDiff(change: ProposedChange, root: string): Promise<void> {
  const left = change.kind === 'modify'
    ? vscode.Uri.file(path.resolve(root, change.path))
    : (await vscode.workspace.openTextDocument({ language: 'ruby', content: '' })).uri
  const right = (await vscode.workspace.openTextDocument({ language: 'ruby', content: change.after })).uri
  await vscode.commands.executeCommand('vscode.diff', left, right, `${change.path}: RailsForge proposal`)
}

/** Returns the first change whose current text no longer matches what the plan was built from, or undefined. */
async function staleChange(changes: readonly ProposedChange[], root: string): Promise<string | undefined> {
  for (const change of changes) {
    const absolute = path.resolve(root, change.path)
    if (change.kind === 'create') {
      if (fs.existsSync(absolute)) {return change.path}
      continue
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute))
    if (doc.getText() !== change.before) {return change.path}
  }
  return undefined
}

async function toOperations(changes: readonly ProposedChange[], root: string): Promise<EditOperation[]> {
  const ops: EditOperation[] = []
  for (const change of changes) {
    const uri = vscode.Uri.file(path.resolve(root, change.path))
    if (change.kind === 'create') {
      ops.push({ kind: 'createFile', uri, contents: change.after, overwrite: false })
      continue
    }
    const doc = await vscode.workspace.openTextDocument(uri)
    const end = doc.lineAt(Math.max(0, doc.lineCount - 1)).range.end
    ops.push({ kind: 'replace', uri, range: new vscode.Range(new vscode.Position(0, 0), end), newText: change.after })
  }
  return ops
}

function toSelectionLines(range: vscode.Range | vscode.Selection): SelectionLines {
  return { startLine: range.start.line + 1, endLine: range.end.line + 1, isEmpty: range.isEmpty }
}

/** Workspace-relative path with forward slashes, or undefined when the file lies outside the root. */
function relativeTo(root: string, file: string): string | undefined {
  const relative = path.relative(root, file)
  if (relative === '' || path.isAbsolute(relative) || relative.split(path.sep)[0] === '..') {return undefined}
  return relative.split(path.sep).join('/')
}

function withProgress<T>(title: string, task: () => Promise<T>): Thenable<T> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => task())
}

function reasonHeadline(reason: AdvisorFailure): string {
  switch (reason) {
    case 'model-unavailable': return 'the AI provider did not answer.'
    case 'invalid-response': return 'the AI answer was not usable, even after one retry.'
    case 'unsafe-path':
    case 'file-not-allowed': return 'the AI proposed a file outside the allowed scope.'
    case 'hunk-mismatch': return 'the AI diff no longer matches the file.'
    case 'syntax-error': return 'the AI change would not parse as Ruby.'
    case 'too-large': return 'the affected files are too large for an in-editor apply.'
    case 'no-change': return 'the AI diff changed nothing.'
    case 'file-missing':
    case 'file-exists': return 'the AI create/edit mismatch the file system.'
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
