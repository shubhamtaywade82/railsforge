/**
 * RefactoringCommand - the explicit analysis flow behind `railsforge.suggestRefactorings`.
 *
 *   1. Resolve the scope (method, class or selection) and collect deterministic candidates.
 *      No candidates -> say so. No model call is made.
 *   2. Ask the AI to decide on those candidates (one call, on this explicit request).
 *      If the AI is unavailable, show the rule-based recommendations and say so.
 *   3. Pick a recommendation: it opens as a reviewable document (problem, evidence, design,
 *      alternatives, benefit, risk, files, verification).
 *   4. Only after an explicit "Preview change", the AI writes the diff. The diff is shown as native
 *      diffs and applied after a modal confirmation, as one undoable WorkspaceEdit.
 *
 * Nothing is written before the final confirmation. The change is re-checked against the open
 * buffers at apply time: if a file changed while the preview was open, the apply is refused.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { Logger } from '../../util/Logger'
import { EditOperation, RefactoringEditProvider } from '../../providers/RefactoringEditProvider'
import { RefactoringAdvisor } from '../core/RefactoringAdvisor'
import { RefactoringEngine } from '../core/RefactoringEngine'
import { describeTarget, TargetResolver } from '../core/ScopeResolver'
import { AdvisorFailure, AdvisorResult, describeScope, ProposedChange, Recommendation } from '../core/types'
import { renderRecommendation } from '../recommendations/RecommendationRenderer'
import { relativeTo, toSelectionLines, withProgress } from './workspacePaths'

export const SUGGEST_REFACTORINGS_COMMAND = 'railsforge.suggestRefactorings'

export interface RefactoringCommandDeps {
  engine: RefactoringEngine
  advisor: RefactoringAdvisor
  resolver: TargetResolver
  editProvider: RefactoringEditProvider
  /** Absolute path of the project the analysis and file reader are bound to. */
  projectRoot: () => string | undefined
}

interface RecommendationItem extends vscode.QuickPickItem {
  recommendation: Recommendation
}

export class RefactoringCommand {
  constructor(private readonly deps: RefactoringCommandDeps) {}

  /** Entry point. Invoked from a code action or CodeLens (uri + range) or from the palette (active editor). */
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

    const candidates = this.deps.engine.candidatesIn(relativePath, content, target)
    const rules = this.deps.engine.recommendations(relativePath, content, target)
    if (rules.length === 0) {
      void vscode.window.showInformationMessage(`RailsForge: no refactoring worth making in ${label}. The code is already appropriate for its role.`)
      return
    }

    try {
      const refined = await withProgress(`RailsForge: asking the AI to review ${label}`, () =>
        this.deps.advisor.refine({ path: relativePath, content, scope: target, candidates }))

      let recommendations: Recommendation[]
      if (refined.ok) {
        if (refined.value.recommendations.length === 0) {
          const reasons = refined.value.skipped.slice(0, 2).map(s => s.reason).join(' ')
          void vscode.window.showInformationMessage(`RailsForge: the AI found nothing worth changing in ${label}. ${reasons}`.trim())
          return
        }
        recommendations = refined.value.recommendations
      } else {
        this.report(refined, 'showing the rule-based recommendations instead')
        recommendations = rules
      }

      const items: RecommendationItem[] = recommendations.map(recommendation => ({
        label: `$(lightbulb) ${recommendation.title}`,
        description: `${recommendation.priority} · ${recommendation.confidence} confidence · ${recommendation.source === 'ai' ? 'AI' : 'rule-based'}`,
        detail: recommendation.problem,
        recommendation,
      }))
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Recommendations for ${describeScope(target)}`,
        matchOnDetail: true,
      })
      if (!picked) {return}

      await this.review(picked.recommendation, root)
    } catch (err) {
      Logger.error(`[Refactoring] ${String(err)}`)
      void vscode.window.showErrorMessage(`RailsForge: the refactoring analysis failed: ${errorText(err)}`)
    }
  }

  /** Shows the recommendation as a document, then asks before any AI-written change is requested. */
  private async review(recommendation: Recommendation, root: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: renderRecommendation(recommendation) })
    await vscode.window.showTextDocument(doc, { preview: true })

    const choice = await vscode.window.showInformationMessage(
      `Preview the change for "${recommendation.title}"? The AI will write a diff over ${recommendation.affectedFiles.length} file(s).`,
      'Preview change',
    )
    if (choice !== 'Preview change') {return}
    await this.previewAndApply(recommendation, root)
  }

  private async previewAndApply(recommendation: Recommendation, root: string): Promise<void> {
    const plan = await withProgress(`RailsForge: preparing "${recommendation.title}"`, () => this.deps.advisor.plan(recommendation))
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
      `Apply "${recommendation.title}" to ${changes.length} file(s)?`,
      { modal: true, detail },
      'Apply',
    )
    if (choice !== 'Apply') {return}

    const stale = await staleChange(changes, root)
    if (stale) {
      void vscode.window.showWarningMessage(`RailsForge: ${stale} changed while the preview was open. Run the analysis again.`)
      return
    }

    const ops = await toOperations(changes, root)
    const applied = await this.deps.editProvider.apply(ops, { label: recommendation.title })
    if (!applied) {
      void vscode.window.showWarningMessage('RailsForge: the change was not applied.')
      return
    }
    Logger.info(`[Refactoring] applied "${recommendation.title}" to ${changes.length} file(s)`)
    void vscode.window.showInformationMessage(`RailsForge: applied "${recommendation.title}" to ${changes.length} file(s). Review the changes before saving.`)
  }

  private report(failure: Extract<AdvisorResult<unknown>, { ok: false }>, followUp?: string): void {
    Logger.warn(`[Refactoring] ${failure.reason}: ${failure.message}`)
    const tail = followUp ? ` (${followUp})` : ''
    void vscode.window.showWarningMessage(`RailsForge: ${reasonHeadline(failure.reason)} ${truncate(failure.message, 300)}${tail}`)
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
