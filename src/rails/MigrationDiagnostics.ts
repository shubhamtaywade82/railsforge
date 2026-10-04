/**
 * MigrationDiagnostics - Real-time diagnostics & QuickFixes for Rails migrations
 */

import * as vscode from 'vscode'
import { StrongMigrationsAnalyzer, MigrationDanger } from './StrongMigrationsAnalyzer'

export class MigrationDiagnostics implements vscode.CodeActionProvider {
  private diagnosticCollection = vscode.languages.createDiagnosticCollection('railsforge-migrations')
  private analyzer = new StrongMigrationsAnalyzer()

  clearFile(uri: vscode.Uri): void {
    this.diagnosticCollection.delete(uri)
  }

  updateDiagnostics(document: vscode.TextDocument): void {
    if (!document.fileName.replace(/\\/g, '/').includes('/db/migrate/')) {
      this.diagnosticCollection.delete(document.uri)
      return
    }

    const code = document.getText()
    const dangers = this.analyzer.analyzeMigration(code)
    const diagnostics: vscode.Diagnostic[] = dangers.map(d => this.toDiagnostic(d))

    this.diagnosticCollection.set(document.uri, diagnostics)
  }

  private toDiagnostic(danger: MigrationDanger): vscode.Diagnostic {
    const line = Math.max(0, danger.line - 1)
    const range = new vscode.Range(line, 0, line, 80)
    const severity = danger.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning

    const diag = new vscode.Diagnostic(range, `${danger.title}: ${danger.recommendation}`, severity)
    diag.source = 'StrongMigrations'
    diag.code = danger.ruleId
    return diag
  }

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = []

    for (const diag of context.diagnostics) {
      if (diag.source !== 'StrongMigrations') {continue}

      if (diag.code === 'MIG-INDEX-001') {
        const fix = new vscode.CodeAction('Add algorithm: :concurrently', vscode.CodeActionKind.QuickFix)
        fix.edit = new vscode.WorkspaceEdit()
        const line = document.lineAt(diag.range.start.line)
        const updated = line.text.replace(/add_index\s+([^,\n]+,\s*[^,\n]+)/, 'add_index $1, algorithm: :concurrently')
        fix.edit.replace(document.uri, line.range, updated)
        actions.push(fix)
      }

      const aiAction = new vscode.CodeAction(`✨ RailsForge AI: Fix migration issue (${diag.code})`, vscode.CodeActionKind.QuickFix)
      aiAction.command = {
        command: 'railsforge.applyAiFix',
        title: 'Apply AI Fix',
        arguments: [document.uri, diag.range, diag.message],
      }
      actions.push(aiAction)
    }

    return actions
  }

  dispose(): void {
    this.diagnosticCollection.dispose()
  }
}
