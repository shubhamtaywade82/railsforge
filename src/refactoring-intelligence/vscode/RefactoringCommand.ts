/**
 * RefactoringCommand - the two entry points behind the refactoring hints.
 *
 *   reviewObserved (railsforge.reviewAiHints)
 *     Shows AI hints already observed for the scope. No model call. Hints are kept per scope and
 *     are only shown while the scope's code is unchanged.
 *
 *   run (railsforge.suggestRefactorings)
 *     1. Collects deterministic candidates for the scope. No candidates: say so, no model call.
 *     2. Asks the AI to decide on those candidates (one call, on this explicit request), and keeps
 *        the answer as an observation. If the AI is unavailable, shows the rule-based recommendations.
 *     3. Opens the picked recommendation as a reviewable document.
 *     4. Only after an explicit "Preview change", the AI writes the diff. The diff is shown as native
 *        diffs and applied after a modal confirmation, as one undoable WorkspaceEdit.
 *
 * Nothing is written before the final confirmation. The change is re-checked against the open buffers
 * at apply time: if a file changed while the preview was open, the apply is refused.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { Logger } from '../../util/Logger'
import { EditOperation, RefactoringEditProvider } from '../../providers/RefactoringEditProvider'
import { RefactoringAdvisor } from '../core/RefactoringAdvisor'
import { RefactoringEngine } from '../core/RefactoringEngine'
import { observedWithin, ObservationStore, recordRefinement } from '../core/ObservationStore'
import { describeTarget, TargetResolver } from '../core/ScopeResolver'
import { AdvisorFailure, AdvisorResult, describeScope, ProposedChange, Recommendation, RefactorTarget } from '../core/types'
import { renderRecommendation } from '../recommendations/RecommendationRenderer'
import { relativeTo, toSelectionLines, withProgress } from './workspacePaths'

// Command IDs are case-sensitive and must match package.json exactly. The repo's convention is lowercase.
export const SUGGEST_REFACTORINGS_COMMAND = 'railsforge.suggestRefactorings'
export const REVIEW_AI_HINTS_COMMAND = 'railsforge.reviewAiHints'

export interface RefactoringCommandDeps {
  engine: RefactoringEngine
  advisor: RefactoringAdvisor
  resolver: TargetResolver
  editProvider: RefactoringEditProvider
  observations: ObservationStore
  /** Absolute path of the project the analysis and file reader are bound to. */
  projectRoot: () => string | undefined
}

interface RecommendationItem extends vscode.QuickPickItem {
  recommendation: Recommendation
}

/** Everything a request needs, resolved from the editor (or from the arguments a code action passed). */
interface Request {
  root: string
  relativePath: string
  content: string
  target: RefactorTarget
  label: string
}

export class RefactoringCommand {
  constructor(private readonly deps: RefactoringCommandDeps) {}

  /** Shows AI hints already observed for the scope. Never calls a model. */
  async reviewObserved(uriArg?: vscode.Uri, rangeArg?: vscode.Range | vscode.Selection): Promise<void> {
    const request = await this.resolveRequest(uriArg, rangeArg)
    if (!request) {return}

    const observed = observedWithin(
      this.deps.observations,
      request.relativePath,
      request.content,
      this.deps.engine.scopes(request.content),
      request.target,
    ).filter(r => r.confidence !== 'low')

    if (observed.length === 0) {
      void vscode.window.showInformationMessage(
        `RailsForge: no AI hints observed for ${request.label} yet. Run Suggest Refactorings to ask the AI, or set railsForge.refactoring.aiHints to on-save.`,
      )
      return
    }
    await this.pick(observed, request, 'AI hints observed for')
  }

  /** Asks the AI about the scope's measured findings, keeps the answer, and offers a review. */
  async run(uriArg?: vscode.Uri, rangeArg?: vscode.Range | vscode.Selection): Promise<void> {
    const request = await this.resolveRequest(uriArg, rangeArg)
    if (!request) {return}
    const { relativePath, content, target, label } = request

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
        recordRefinement(this.deps.observations, relativePath, content, target, refined.value.recommendations)
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

      await this.pick(recommendations, request, `Recommendations for ${describeScope(target)}`)
    } catch (err) {
      Logger.error(`[Refactoring] ${String(err)}`)
      void vscode.window.showErrorMessage(`RailsForge: the refactoring analysis failed: ${errorText(err)}`)
    }
  }

  /** Resolves the request from a code action's arguments, or from the active editor. */
  private async resolveRequest(uriArg?: vscode.Uri, rangeArg?: vscode.Range | vscode.Selection): Promise<Request | undefined> {
    const editor = vscode.window.activeTextEditor
    const uri = uriArg ?? editor?.document.uri
    const range = rangeArg ?? (uriArg ? undefined : editor?.selection)
    if (!uri || !range) {
      void vscode.window.showInformationMessage('RailsForge: open a Ruby file and put the cursor in a class, module or method first.')
      return undefined
    }

    const root = this.deps.projectRoot()
    if (!root) {
      void vscode.window.showWarningMessage('RailsForge: open a Rails project folder first.')
      return undefined
    }
    const document = await vscode.workspace.openTextDocument(uri)
    const relativePath = relativeTo(root, document.uri.fsPath)
    if (!relativePath) {
      void vscode.window.showWarningMessage('RailsForge: this file is outside the project the advisor is bound to.')
      return undefined
    }

    const content = document.getText()
    const resolution = this.deps.resolver.resolve(content, toSelectionLines(range))
    if (!resolution.ok) {
      void vscode.window.showInformationMessage(`RailsForge: ${resolution.message}`)
      return undefined
    }
    return { root, relativePath, content, target: resolution.target, label: describeTarget(resolution.target) }
  }

  private async pick(recommendations: readonly Recommendation[], request: Request, placeHolder: string): Promise<void> {
    const items: RecommendationItem[] = recommendations.map(recommendation => ({
      label: `$(lightbulb) ${recommendation.title}`,
      description: `${recommendation.priority} · ${recommendation.confidence} confidence · ${recommendation.source === 'ai' ? 'AI' : 'rule-based'}`,
      detail: recommendation.problem,
      recommendation,
    }))
    const picked = await vscode.window.showQuickPick(items, { placeHolder: `${placeHolder} ${request.label}`, matchOnDetail: true })
    if (!picked) {return}
    await this.review(picked.recommendation, request.root)
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
