/**
 * RailsDeprecationLinter - Version-aware deprecation diagnostics and quick fixes
 */

import * as vscode from 'vscode'
import { ProjectEnvironment } from '../environment/EnvironmentDetector'

export interface DeprecationRule {
  id: string
  pattern: RegExp
  replacement: string
  minRailsVersion: number
  message: string
}

export class RailsDeprecationLinter implements vscode.CodeActionProvider {
  private diagnosticCollection = vscode.languages.createDiagnosticCollection('railsforge-deprecations')

  private rules: DeprecationRule[] = [
    {
      id: 'RAILS-DEP-001',
      pattern: /\bupdate_attributes!?\b/g,
      replacement: 'update',
      minRailsVersion: 5,
      message: '`update_attributes` is deprecated in Rails 5+ and removed in Rails 6. Use `update` instead.',
    },
    {
      id: 'RAILS-DEP-002',
      pattern: /\brender\s+:text\s*=>/g,
      replacement: 'render plain:',
      minRailsVersion: 5,
      message: '`render :text` is deprecated in Rails 5+. Use `render plain:` or `render html:` instead.',
    },
    {
      id: 'RAILS-DEP-003',
      pattern: /\b(before|after|around)_filter\b/g,
      replacement: '$1_action',
      minRailsVersion: 5,
      message: '`*_filter` callbacks are removed in Rails 5+. Use `*_action` instead.',
    },
  ]

  updateDiagnostics(document: vscode.TextDocument, env: ProjectEnvironment): void {
    if (!document || typeof document.getText !== 'function' || (document.languageId !== 'ruby' && document.languageId !== 'erb')) {
      return
    }

    const diagnostics: vscode.Diagnostic[] = []
    const lines = document.getText().split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      for (const rule of this.rules) {
        if (env.majorRailsVersion >= rule.minRailsVersion) {
          let match: RegExpExecArray | null
          rule.pattern.lastIndex = 0
          while ((match = rule.pattern.exec(line)) !== null) {
            const start = new vscode.Position(i, match.index)
            const end = new vscode.Position(i, match.index + match[0].length)
            const range = new vscode.Range(start, end)

            const diag = new vscode.Diagnostic(range, rule.message, vscode.DiagnosticSeverity.Warning)
            diag.source = 'RailsForge'
            diag.code = rule.id
            diagnostics.push(diag)
          }
        }
      }
    }

    this.diagnosticCollection.set(document.uri, diagnostics)
  }

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = []

    for (const diag of context.diagnostics) {
      if (diag.source !== 'RailsForge' || !diag.code) {continue}

      const rule = this.rules.find(r => r.id === diag.code)
      if (rule) {
        const fix = new vscode.CodeAction(`Replace with ${rule.replacement}`, vscode.CodeActionKind.QuickFix)
        fix.edit = new vscode.WorkspaceEdit()
        const text = document.getText(diag.range)
        const updated = text.replace(rule.pattern, rule.replacement)
        fix.edit.replace(document.uri, diag.range, updated)
        actions.push(fix)
      }

      const aiAction = new vscode.CodeAction(`✨ RailsForge AI: Fix deprecation (${diag.code})`, vscode.CodeActionKind.QuickFix)
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
