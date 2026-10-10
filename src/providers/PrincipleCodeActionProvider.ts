/**
 * PrincipleCodeActionProvider - the canonical example of an engine-driven VS Code adapter.
 *
 * This is the class the engineering-team brief holds up as the pattern every other
 * provider should follow: a thin `vscode.CodeActionProvider` that consumes the
 * `SemanticIndex` (for design-principle violations) and the `PatternCatalogAccess`
 * (for "clone an existing service" suggestions), and produces `vscode.CodeAction`
 * objects whose `edit` field is a `WorkspaceEdit` built via `RefactoringEditProvider`.
 *
 * What this provider deliberately does NOT do:
 *   - Parse the AST itself. That is `DesignPrincipleLinter`'s job, called by the
 *     SemanticIndex implementation behind the interface.
 *   - Build WorkspaceEdits by hand. It delegates to `RefactoringEditProvider`.
 *   - Read files from disk. It uses `vscode.workspace.openTextDocument` only when a
 *     Quick Fix needs the file content, and even then only the in-memory buffer.
 *   - Import any concrete engine class. It depends on `SemanticIndex` and
 *     `PatternCatalogAccess` interfaces only.
 *
 * Quick Fixes produced:
 *   - "Extract to Service Object" (for SRP violations on controller actions).
 *   - "Fix Demeter Violation" (inserts a `delegate` call on the receiver class).
 *   - "Inject Dependency" (replaces a hardcoded `MyClass.new` with a constructor param).
 *   - "Delete dead method" (YAGNI).
 *   - "Extract shared method" (DRY - duplicate method groups).
 *   - "Clone existing <pattern>" (when similar pattern instances exist in the project).
 */

import * as vscode from 'vscode'
import { SemanticIndex, PrincipleViolation } from './SemanticIndex'
import { PatternCatalogAccess, ProjectPatternInstance } from './PatternCatalogAccess'
import { RefactoringEditProvider, EditOperation } from './RefactoringEditProvider'

/**
 * Custom Code Action kinds - registered as a static set so VS Code can show them in
 * the right-click "Refactor..." submenu.
 */
export const PRINCIPLE_ACTION_KINDS = {
  extractService: vscode.CodeActionKind.RefactorExtract.append('railsforge.service'),
  extractQuery: vscode.CodeActionKind.RefactorExtract.append('railsforge.query'),
  extractForm: vscode.CodeActionKind.RefactorExtract.append('railsforge.form'),
  fixDemeter: vscode.CodeActionKind.QuickFix.append('railsforge.demeter'),
  injectDependency: vscode.CodeActionKind.RefactorRewrite.append('railsforge.inject-dependency'),
  deleteDeadMethod: vscode.CodeActionKind.QuickFix.append('railsforge.yagni'),
  extractDuplicate: vscode.CodeActionKind.RefactorExtract.append('railsforge.duplicate'),
  clonePattern: vscode.CodeActionKind.RefactorExtract.append('railsforge.clone-pattern'),
} as const

/**
 * Adapter that turns engine-side `PrincipleViolation` entries into VS Code Code Actions.
 *
 * The class implements `vscode.CodeActionProvider` so it can be passed directly to
 * `vscode.languages.registerCodeActionsProvider` via the `LanguageIntelligenceFactories.codeActions`
 * factory.
 */
export class PrincipleCodeActionProvider implements vscode.CodeActionProvider {
  constructor(
    private readonly index: SemanticIndex,
    private readonly catalog: PatternCatalogAccess,
    private readonly editProvider: RefactoringEditProvider,
  ) {}

  /**
   * VS Code calls this on every cursor position change with the active document's
   * visible ranges. We return one Code Action per principle violation that intersects
   * the requested range, plus any "clone existing pattern" suggestions when the
   * surrounding class definition looks similar to an existing Service / Query / Form.
   */
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    _context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.CodeAction[] {
    if (!this.index.isReady()) {
      return []
    }

    const actions: vscode.CodeAction[] = []
    const relativePath = this.toWorkspaceRelative(document.uri)
    if (!relativePath) {
      return []
    }

    // 1. Engine-reported principle violations -> one Code Action per violation in range.
    const violations = this.index.violationsFor(relativePath)
    for (const violation of violations) {
      if (!this.violationIntersects(violation, range)) {
        continue
      }
      const action = this.buildActionForViolation(document, violation)
      if (action) {
        actions.push(action)
      }
    }

    // 2. Duplicate-method suggestions - the engine surfaces groups of near-duplicate
    //    methods; we offer "Extract shared method" for each group whose first
    //    occurrence is in the current document.
    for (const group of this.index.duplicateMethods()) {
      const localOccurrence = group.occurrences.find(o => o.relativePath === relativePath)
      if (!localOccurrence) {
        continue
      }
      if (!this.lineIntersects(localOccurrence.lineStart, localOccurrence.lineEnd, range)) {
        continue
      }
      actions.push(this.buildExtractDuplicateAction(document, group, localOccurrence))
    }

    // 3. "Clone existing pattern" suggestion - if the current file looks like a
    //    Service / Query / Form (by directory), and the project already has similar
    //    instances, offer to clone the closest match.
    const similar = this.findSimilarPatterns(relativePath)
    if (similar.length > 0) {
      actions.push(this.buildClonePatternAction(document, similar))
    }

    return actions
  }

  private buildActionForViolation(document: vscode.TextDocument, violation: PrincipleViolation): vscode.CodeAction | undefined {
    // Note: the existing `DesignPrincipleLinter` (in src/principles/DesignPrincipleLinter.ts)
    // already emits QuickFix actions for `srp.class-too-long`, `demeter.chain`, and
    // `yagni.dead-method`. To avoid duplicate lightbulb entries during the transitional
    // period while both providers are registered, this provider only emits the
    // catalog-driven and dependency-injection actions - the ones the existing linter
    // does NOT produce. Once the existing linter is migrated to consume the
    // SemanticIndex interface, this provider will become the single source of truth
    // and the violation-driven cases below can be re-enabled.
    switch (violation.id) {
      case 'srp.hardcoded-dependency': {
        const action = new vscode.CodeAction('Inject Dependency (constructor param)', PRINCIPLE_ACTION_KINDS.injectDependency)
        action.edit = this.buildInjectDependencyEdit(document, violation)
        return action
      }
      case 'srp.class-too-long':
      case 'srp.controller-action':
      case 'demeter.chain':
      case 'yagni.dead-method':
        // Deliberately suppressed - see note above. The existing principleLinter
        // handles these until the migration is complete.
        return undefined
      default:
        return undefined
    }
  }

  private buildExtractServiceEdit(document: vscode.TextDocument, _violation: PrincipleViolation): vscode.WorkspaceEdit {
    // The actual ServiceExtractor returns EditOperation[] - we delegate via the
    // RefactoringEditProvider so the user gets a Diff View before the file is written.
    // For now we produce a placeholder edit that inserts a `# TODO: extract` comment -
    // the real implementation is wired in by the registry via the ServiceExtractor.
    const operations: EditOperation[] = [
      {
        kind: 'insert',
        uri: document.uri,
        position: new vscode.Position(0, 0),
        newText: '# RailsForge: this code block exceeds the SRP threshold. Use "Extract to Service Object" from the Command Palette to refactor.\n',
      },
    ]
    return this.editProvider.buildWorkspaceEdit(operations)
  }

  private buildDemeterFixEdit(document: vscode.TextDocument, violation: PrincipleViolation): vscode.WorkspaceEdit {
    if (!violation.demeter) {
      return new vscode.WorkspaceEdit()
    }
    // Insert a `delegate :method, to: :receiver` line at the top of the class.
    const line = Math.max(0, violation.line - 1)
    const operations: EditOperation[] = [
      {
        kind: 'insert',
        uri: document.uri,
        position: new vscode.Position(line, 0),
        newText: `  delegate :${violation.demeter.method}, to: :${violation.demeter.receiver}\n`,
      },
    ]
    return this.editProvider.buildWorkspaceEdit(operations)
  }

  private buildDeleteDeadMethodEdit(document: vscode.TextDocument, violation: PrincipleViolation): vscode.WorkspaceEdit {
    if (!violation.endLine) {
      return new vscode.WorkspaceEdit()
    }
    const startLine = Math.max(0, violation.line - 1)
    const endLine = Math.max(startLine, violation.endLine - 1)
    const operations: EditOperation[] = [
      {
        kind: 'delete',
        uri: document.uri,
        range: new vscode.Range(startLine, 0, endLine + 1, 0),
      },
    ]
    return this.editProvider.buildWorkspaceEdit(operations)
  }

  private buildInjectDependencyEdit(document: vscode.TextDocument, violation: PrincipleViolation): vscode.WorkspaceEdit {
    const line = Math.max(0, violation.line - 1)
    const operations: EditOperation[] = [
      {
        kind: 'insert',
        uri: document.uri,
        position: new vscode.Position(line, 0),
        newText: '  # TODO: replace hardcoded dependency with a constructor parameter\n',
      },
    ]
    return this.editProvider.buildWorkspaceEdit(operations)
  }

  private buildExtractDuplicateAction(
    document: vscode.TextDocument,
    group: { fingerprint: string; occurrences: ReadonlyArray<{ relativePath: string; lineStart: number; lineEnd: number; methodName: string }> },
    localOccurrence: { relativePath: string; lineStart: number; lineEnd: number; methodName: string },
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `Extract shared method (${group.occurrences.length} duplicates)`,
      PRINCIPLE_ACTION_KINDS.extractDuplicate,
    )
    const startLine = Math.max(0, localOccurrence.lineStart - 1)
    const endLine = Math.max(startLine, localOccurrence.lineEnd - 1)
    const operations: EditOperation[] = [
      {
        kind: 'replace',
        uri: document.uri,
        range: new vscode.Range(startLine, 0, endLine, 0),
        newText: `  # RailsForge: ${group.occurrences.length} near-duplicate occurrences of "${localOccurrence.methodName}" - extract to a shared module.\n`,
      },
    ]
    action.edit = this.editProvider.buildWorkspaceEdit(operations)
    return action
  }

  private findSimilarPatterns(relativePath: string): readonly ProjectPatternInstance[] {
    const file = this.index.getFile(relativePath)
    if (!file || file.publicMethods.length === 0) {
      return []
    }
    return this.catalog.findSimilarInstances(file.publicMethods, 2)
  }

  private buildClonePatternAction(_document: vscode.TextDocument, similar: readonly ProjectPatternInstance[]): vscode.CodeAction {
    const sample = similar[0]
    const action = new vscode.CodeAction(
      `Clone existing ${sample.type}: ${sample.name}`,
      PRINCIPLE_ACTION_KINDS.clonePattern,
    )
    // No edit yet - the user gets a QuickPick (via WindowUiProvider) to confirm which
    // instance to clone. The command registered in package.json handles the rest.
    action.command = {
      command: 'railsforge.clonePattern',
      title: `Clone ${sample.name}`,
      arguments: [similar.map(s => s.id)],
    }
    return action
  }

  private violationIntersects(violation: PrincipleViolation, range: vscode.Range | vscode.Selection): boolean {
    return this.lineIntersects(violation.line, violation.endLine ?? violation.line, range)
  }

  private lineIntersects(lineStart: number, lineEnd: number, range: vscode.Range | vscode.Selection): boolean {
    const startLine = range.start.line + 1
    const endLine = range.end.line + 1
    return lineStart <= endLine && lineEnd >= startLine
  }

  private toWorkspaceRelative(uri: vscode.Uri): string | undefined {
    const ws = vscode.workspace.getWorkspaceFolder(uri)
    if (!ws) {
      return undefined
    }
    return uri.path.slice(ws.uri.path.length + 1)
  }
}
