/**
 * DesignPrincipleLinter - Analyzes code for SOLID, DRY, KISS, YAGNI, and Law of Demeter violations
 */

import * as vscode from 'vscode'
import { getLearningResource } from './LearningResources'

export interface PrincipleDiagnostic {
  id: string
  title: string
  message: string
  line: number
  severity: vscode.DiagnosticSeverity
  quickFixTitle?: string
  quickFixCommand?: string
  /** YAGNI: last line (1-based) of the unused method, so the Quick Fix can delete the whole block. */
  endLine?: number
  /** Demeter: first receiver and final message in the chain, so the Quick Fix can propose a `delegate`. */
  demeter?: { receiver: string; method: string }
}

export class DesignPrincipleLinter implements vscode.CodeActionProvider {
  private diagnosticCollection = vscode.languages.createDiagnosticCollection('railsforge-principles')
  private metadataByDoc: Map<string, PrincipleDiagnostic[]> = new Map()

  /**
   * Public read accessor for the most recently computed diagnostics for a given
   * document URI. Returns an empty array if the document has not been analyzed yet
   * (e.g. before the first save or cursor move). Used by the provider layer's
   * `SemanticIndexAdapter` so the `PrincipleCodeActionProvider` can surface Quick
   * Fixes for violations without re-running the linter.
   */
  diagnosticsFor(uri: vscode.Uri): PrincipleDiagnostic[] {
    return this.metadataByDoc.get(uri.toString()) ?? []
  }

  updateDiagnostics(document: vscode.TextDocument): void {
    if (document.languageId !== 'ruby' || document.isUntitled) {
      return
    }

    const content = document.getText()
    const lines = content.split('\n')
    const diagnostics: PrincipleDiagnostic[] = []

    this.checkSRP(document.fileName, lines, diagnostics)
    this.checkLawOfDemeter(lines, diagnostics)
    this.checkKISS(lines, diagnostics)
    this.checkYAGNI(lines, diagnostics)

    this.metadataByDoc.set(document.uri.toString(), diagnostics)

    const vscDiagnostics: vscode.Diagnostic[] = diagnostics.map(d => {
      const line = Math.max(0, d.line - 1)
      const range = new vscode.Range(line, 0, line, 80)
      const diag = new vscode.Diagnostic(range, `[${d.id}] ${d.title}: ${d.message}`, d.severity)
      diag.source = 'RailsForge Principles'
      diag.code = d.id
      return diag
    })

    this.diagnosticCollection.set(document.uri, vscDiagnostics)
  }

  private checkSRP(fileName: string, lines: string[], list: PrincipleDiagnostic[]): void {
    const isModelOrController = fileName.includes('/app/models/') || fileName.includes('/app/controllers/')
    // Fat classes are worth flagging outside Rails' app/ convention too (e.g. a gem's lib/),
    // just without Rails-specific "extract to app/services" wording/quick fix.
    const isPlainRubyClass = fileName.includes('/lib/') && !fileName.includes('/app/')
    if (!isModelOrController && !isPlainRubyClass) {return}

    if (lines.length > 200) {
      list.push(isModelOrController
        ? {
          id: 'SRP-FAT-CLASS',
          title: 'Single Responsibility Principle Violation',
          message: `Class has ${lines.length} lines. Consider extracting domain logic into Service Objects (app/services) or Query Objects (app/queries).`,
          line: 1,
          severity: vscode.DiagnosticSeverity.Information,
          quickFixTitle: 'Extract selection to Service Object',
          quickFixCommand: 'railsforge.extractService',
        }
        : {
          id: 'SRP-FAT-CLASS',
          title: 'Single Responsibility Principle Violation',
          message: `Class has ${lines.length} lines. Consider splitting it into smaller, focused classes/modules.`,
          line: 1,
          severity: vscode.DiagnosticSeverity.Information,
        })
    }
  }

  private static readonly PIPELINE_METHODS = new Set([
    'all', 'all?', 'ancestors', 'any', 'any?', 'append', 'as_json', 'blank?', 'class', 'clear',
    'clone', 'collect', 'compact', 'compact!', 'compact_blank', 'concat', 'count', 'delete',
    'delete_at', 'delete_if', 'dequeue', 'detect', 'dig', 'distinct', 'downcase', 'drop',
    'dup', 'each', 'each_with_index', 'each_with_object', 'eager_load', 'empty?', 'enqueue',
    'entries', 'fetch', 'filter', 'filter_map', 'find', 'find_all', 'find_by', 'find_each',
    'find_in_batches', 'first', 'flat_map', 'flatten', 'flatten!', 'freeze', 'frozen?',
    'grep', 'group', 'group_by', 'having', 'includes', 'inject', 'insert', 'inspect', 'itself',
    'join', 'joins', 'keep_if', 'keys', 'last', 'left_joins', 'length', 'limit', 'map', 'match',
    'match?', 'max', 'max_by', 'member?', 'merge', 'min', 'min_by', 'nil?', 'none', 'none?',
    'offset', 'one?', 'order', 'partition', 'pluck', 'pop', 'preload', 'prepend', 'presence',
    'present?', 'public_send', 'push', 'reduce', 'reject', 'reorder', 'replace', 'reselect',
    'respond_to?', 'reverse', 'reverse!', 'rewhere', 'rotate', 'sample', 'scan', 'select',
    'send', 'shift', 'shuffle', 'size', 'slice', 'slice!', 'sort', 'sort!', 'sort_by',
    'split', 'squeeze', 'strip', 'sub', 'gsub', 'sum', 'superclass', 'take', 'tally', 'tap',
    'then', 'to_a', 'to_f', 'to_h', 'to_i', 'to_json', 'to_s', 'to_sym', 'transform_keys',
    'transform_values', 'tr', 'uniq', 'uniq!', 'unshift', 'unscope', 'upcase', 'values',
    'where', 'with_indifferent_access', 'yield_self', 'zip',
  ])

  private static readonly UTILITY_ROOTS = new Set([
    'Rails', 'ENV', 'Logger', 'JSON', 'YAML', 'File', 'Dir', 'Pathname', 'URI', 'DateTime', 'Time', 'Date', 'config',
  ])

  private checkLawOfDemeter(lines: string[], list: PrincipleDiagnostic[]): void {
    const demeterRegex = /\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*){3,})\b/
    const stringLiteralRegex = /(["'])(?:\\.|(?!\1).)*\1/g
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trim().startsWith('#')) {continue}

      // Dotted text inside strings (IPs, hostnames, versions) is data, not a call chain.
      const match = demeterRegex.exec(line.replace(stringLiteralRegex, '""'))
      if (!match) {continue}

      const segments = match[1].split('.')
      const root = segments[0]
      if (DesignPrincipleLinter.UTILITY_ROOTS.has(root)) {continue}

      // Method chains involving collection transforms or query builders are fluent pipelines, not Demeter violations.
      const isPipeline = segments.slice(1).some(seg => DesignPrincipleLinter.PIPELINE_METHODS.has(seg))
      if (isPipeline) {continue}

      list.push({
        id: 'DEMETER-VIOLATION',
        title: 'Law of Demeter Violation',
        message: `Deep association chain detected: '${match[1]}'. Use 'delegate :method, to: :assoc' or encapsulate in a model method.`,
        line: i + 1,
        severity: vscode.DiagnosticSeverity.Warning,
        demeter: { receiver: root, method: segments[segments.length - 1] },
      })
    }
  }

  private checkKISS(lines: string[], list: PrincipleDiagnostic[]): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (/\b(?:define_method|class_eval|instance_eval)\b/.test(line)) {
        list.push({
          id: 'KISS-METAPROGRAMMING',
          title: 'KISS Principle Warning',
          message: 'Dynamic metaprogramming detected. Prefer explicit methods, modules, or case statements for readability and maintainability.',
          line: i + 1,
          severity: vscode.DiagnosticSeverity.Information,
        })
      }
    }
  }

  private checkYAGNI(lines: string[], list: PrincipleDiagnostic[]): void {
    let insidePrivate = false
    const privateMethods: Array<{ name: string; line: number; endLine: number }> = []
    const fullText = lines.join('\n')

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (trimmed === 'private' || trimmed === 'protected') {
        insidePrivate = true
        continue
      }

      if (insidePrivate) {
        const defMatch = /^def\s+([a-zA-Z0-9_]+)/.exec(trimmed)
        if (defMatch) {
          privateMethods.push({ name: defMatch[1], line: i + 1, endLine: this.findMethodEndLine(lines, i) })
        }
      }
    }

    for (const m of privateMethods) {
      const occurrences = fullText.split(new RegExp(`\\b${m.name}\\b`)).length - 1
      if (occurrences <= 1) {
        list.push({
          id: 'YAGNI-UNUSED-PRIVATE',
          title: 'Potential YAGNI Violation',
          message: `Private method '${m.name}' is defined but never invoked in this file.`,
          line: m.line,
          severity: vscode.DiagnosticSeverity.Hint,
          endLine: m.endLine,
        })
      }
    }
  }

  /** Given the 0-based index of a `def ...` line, finds the 1-based line of its matching `end`. */
  private findMethodEndLine(lines: string[], defLineIndex: number): number {
    const defLine = lines[defLineIndex].trim()
    if (/\)\s*=(?!=|>)/.test(defLine) || /^def\s+\S+\s*=(?!=|>)/.test(defLine)) {
      return defLineIndex + 1
    }

    let depth = 1
    for (let i = defLineIndex + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (/^(class|module|if|unless|case|while|until|begin|def)\b/.test(trimmed) || /\bdo(\s*\|[^|]*\|)?\s*$/.test(trimmed)) {
        depth++
      }
      if (trimmed === 'end' || /^end\b/.test(trimmed)) {
        depth--
        if (depth === 0) {return i + 1}
      }
    }
    return defLineIndex + 1
  }

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = []
    const metadata = this.metadataByDoc.get(document.uri.toString()) ?? []

    for (const diag of context.diagnostics) {
      if (diag.source !== 'RailsForge Principles') {continue}

      const meta = metadata.find(m => m.id === diag.code && Math.max(0, m.line - 1) === diag.range.start.line)

      // Only offer the Rails-specific "extract to app/services" fix for the model/controller
      // variant of this diagnostic — a gem/script's fat class doesn't have that quick fix.
      if (diag.code === 'SRP-FAT-CLASS' && meta?.quickFixCommand === 'railsforge.extractService') {
        const extractAction = new vscode.CodeAction(
          'Extract selected code to Service Object',
          vscode.CodeActionKind.RefactorExtract,
        )
        extractAction.isPreferred = true
        extractAction.command = {
          command: 'railsforge.extractService',
          title: 'Extract Service Object',
        }
        actions.push(extractAction)
      }

      const isRailsApp = document.fileName.includes('/app/')
      if (diag.code === 'DEMETER-VIOLATION' && meta?.demeter && isRailsApp) {
        const { receiver, method } = meta.demeter
        const delegateAction = new vscode.CodeAction(
          `Add 'delegate :${method}, to: :${receiver}'`,
          vscode.CodeActionKind.QuickFix,
        )
        delegateAction.isPreferred = true
        delegateAction.edit = this.buildDelegateEdit(document, diag.range.start.line, receiver, method)
        actions.push(delegateAction)
      }

      if (diag.code === 'YAGNI-UNUSED-PRIVATE' && meta?.endLine) {
        const removeAction = new vscode.CodeAction('Remove unused method', vscode.CodeActionKind.QuickFix)
        removeAction.isPreferred = true
        const edit = new vscode.WorkspaceEdit()
        const start = new vscode.Position(diag.range.start.line, 0)
        const end = new vscode.Position(meta.endLine, 0)
        edit.delete(document.uri, new vscode.Range(start, end))
        removeAction.edit = edit
        actions.push(removeAction)
      }

      const aiAction = new vscode.CodeAction(`✨ RailsForge AI: Fix ${meta?.title ?? diag.code}`, vscode.CodeActionKind.QuickFix)
      aiAction.command = {
        command: 'railsforge.applyAiFix',
        title: 'Apply AI Fix',
        arguments: [document.uri, diag.range, diag.message],
      }
      actions.push(aiAction)

      const resource = typeof diag.code === 'string' ? getLearningResource(diag.code) : null
      if (resource) {
        const learnAction = new vscode.CodeAction(`📚 Learn: ${resource.book} — ${resource.chapter}`, vscode.CodeActionKind.Empty)
        learnAction.command = {
          command: 'railsforge.showLearningResource',
          title: 'Show Learning Resource',
          arguments: [resource],
        }
        actions.push(learnAction)
      }
    }

    return actions
  }

  /** Inserts `delegate :method, to: :receiver` with matching indentation right after the enclosing `class` line. */
  private buildDelegateEdit(document: vscode.TextDocument, violationLine: number, receiver: string, method: string): vscode.WorkspaceEdit {
    const edit = new vscode.WorkspaceEdit()
    let classLine = -1
    for (let i = violationLine; i >= 0; i--) {
      if (/^\s*class\s+[A-Z]/.test(document.lineAt(i).text)) {
        classLine = i
        break
      }
    }
    if (classLine === -1) {return edit}

    const classIndent = document.lineAt(classLine).text.match(/^\s*/)?.[0] ?? ''
    const insertAt = new vscode.Position(classLine + 1, 0)
    edit.insert(document.uri, insertAt, `${classIndent}  delegate :${method}, to: :${receiver}\n`)
    return edit
  }

  dispose(): void {
    this.diagnosticCollection.dispose()
    this.metadataByDoc.clear()
  }
}
