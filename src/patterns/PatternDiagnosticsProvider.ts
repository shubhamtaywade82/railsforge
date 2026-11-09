/**
 * PatternDiagnosticsProvider - Live real-time diagnostics and QuickFix suggestions for design patterns & code smells
 */

import * as vscode from 'vscode'
import { PatternRecognitionEngine, PatternOpportunity } from './PatternRecognitionEngine'
import { readConfig, buildExcludeGlob } from '../config/RailsForgeConfig'

export class PatternDiagnosticsProvider implements vscode.CodeActionProvider {
  private diagnosticCollection = vscode.languages.createDiagnosticCollection('railsforge-patterns')
  private engine = new PatternRecognitionEngine()

  updateDiagnostics(document: vscode.TextDocument): void {
    if (!document || typeof document.getText !== 'function' || (document.languageId !== 'ruby' && document.languageId !== 'erb')) {
      return
    }

    const code = document.getText()
    const opportunities = this.engine.analyzeCode(code, document.fileName)
    const diagnostics: vscode.Diagnostic[] = opportunities.map(o => this.toDiagnostic(o, document))

    this.diagnosticCollection.set(document.uri, diagnostics)
  }

  scanWorkspace(): void {
    const excludeGlob = buildExcludeGlob(readConfig().excludePatterns) ?? undefined
    vscode.workspace.findFiles('{app,lib,db}/**/*.rb', excludeGlob).then(uris => {
      for (const uri of uris) {
        void vscode.workspace.openTextDocument(uri).then(doc => {
          this.updateDiagnostics(doc)
        })
      }
    })
  }

  private toDiagnostic(opp: PatternOpportunity, document: vscode.TextDocument): vscode.Diagnostic {
    const line = Math.max(0, opp.line - 1)
    const lineText = document.lineAt(line).text
    const startCol = lineText.length - lineText.trimStart().length
    const range = new vscode.Range(line, startCol, line, lineText.length)
    const severity = opp.id === 'SINGLETON-HAZARD'
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Information

    const diag = new vscode.Diagnostic(range, `💡 [${opp.patternName}] ${opp.title}: ${opp.message}`, severity)
    diag.source = 'RailsForge Patterns'
    diag.code = opp.id
    return diag
  }

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = []

    for (const diag of context.diagnostics) {
      if (diag.source !== 'RailsForge Patterns' || !diag.code) {continue}

      if (diag.code === 'REPLACE-CONDITIONAL-STRATEGY') {
        const fix = new vscode.CodeAction('⚡ Refactor: Replace with Strategy Object', vscode.CodeActionKind.RefactorRewrite)
        fix.command = {
          command: 'railsforge.refactorSelection',
          title: 'Refactor Selection',
        }
        actions.push(fix)
      } else if (diag.code === 'INTRODUCE-FORM-OBJECT') {
        const fix = new vscode.CodeAction('⚡ Refactor: Extract to Form Object', vscode.CodeActionKind.RefactorExtract)
        fix.command = {
          command: 'railsforge.refactorSelection',
          title: 'Refactor to Form Object',
        }
        actions.push(fix)
      } else if (diag.code === 'PRIMITIVE-OBSESSION') {
        const fix = new vscode.CodeAction('⚡ Refactor: Extract to Value Object (Data.define)', vscode.CodeActionKind.RefactorExtract)
        fix.command = {
          command: 'railsforge.refactorSelection',
          title: 'Refactor to Value Object',
        }
        actions.push(fix)
      } else if (diag.code === 'SINGLETON-HAZARD') {
        const fix = new vscode.CodeAction('⚡ Refactor: Replace with Dependency Injection', vscode.CodeActionKind.QuickFix)
        actions.push(fix)
      }

      const aiAction = new vscode.CodeAction(`✨ RailsForge AI: Fix ${diag.code}`, vscode.CodeActionKind.QuickFix)
      aiAction.command = {
        command: 'railsforge.applyAiFix',
        title: 'Apply AI Fix',
        arguments: [document.uri, diag.range, diag.message],
      }
      actions.push(aiAction)

      actions.push(this.askRailsAction(diag))
    }

    return actions
  }

  private askRailsAction(diag: vscode.Diagnostic): vscode.CodeAction {
    const action = new vscode.CodeAction('$(sparkle) Ask @rails to fix this', vscode.CodeActionKind.QuickFix)
    action.command = {
      command: 'workbench.action.chat.open',
      title: 'Ask @rails',
      arguments: [{ query: `@rails /fix ${diag.message}` }],
    }
    return action
  }

  dispose(): void {
    this.diagnosticCollection.dispose()
  }
}
