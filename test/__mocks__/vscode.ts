export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
}

export class Range {
  constructor(
    public startLine: number,
    public startChar: number,
    public endLine: number,
    public endChar: number,
  ) {}
}

export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}

export class Diagnostic {
  public source?: string
  public code?: string | number
  constructor(
    public range: Range,
    public message: string,
    public severity: number = 0,
  ) {}
}

export class CodeAction {
  public edit?: unknown
  public command?: unknown
  constructor(
    public title: string,
    public kind?: unknown,
  ) {}
}

export const CompletionItemKind = {
  Text: 0,
  Method: 1,
  Function: 2,
  Constructor: 3,
  Field: 4,
  Variable: 5,
  Class: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Unit: 10,
  Value: 11,
  Enum: 12,
  Keyword: 13,
  Snippet: 14,
  Color: 15,
  File: 16,
  Reference: 17,
  Folder: 18,
  EnumMember: 19,
  Constant: 20,
  Struct: 21,
  Event: 22,
  Operator: 23,
  TypeParameter: 24,
}

export class CompletionItem {
  public label: string
  public kind: number
  public detail = ''
  public documentation = ''
  public insertText = ''
  public sortText = ''
  constructor(label: string, kind: number) {
    this.label = label
    this.kind = kind
  }
}

export const CodeActionKind = {
  QuickFix: 'QuickFix',
  RefactorExtract: 'RefactorExtract',
}

export class MarkdownString {
  public isTrusted = false
  private value = ''
  appendMarkdown(str: string) {
    this.value += str
    return this
  }
}

export class Hover {
  constructor(
    public contents: MarkdownString,
    public range?: Range,
  ) {}
}

export class ThemeIcon {
  constructor(public id: string) {}
}

export class TreeItem {
  constructor(
    public label: string,
    public collapsibleState?: number,
  ) {}
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
}

export const languages = {
  createDiagnosticCollection: () => ({
    set: () => {},
    delete: () => {},
    dispose: () => {},
  }),
}

export const workspace = {
  createFileSystemWatcher: () => ({
    onDidChange: () => {},
    dispose: () => {},
  }),
}

export const window = {
  createStatusBarItem: () => ({
    show: () => {},
  }),
  createOutputChannel: () => ({
    name: 'RailsForge',
    appendLine: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    show: () => {},
    dispose: () => {},
  }),
}

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: () => Promise.resolve(),
}

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = []
  readonly event = (listener: (e: T) => void): { dispose(): void } => {
    this.listeners.push(listener)
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener) } }
  }
  fire(e?: T): void { for (const l of this.listeners) { l(e as T) } }
  dispose(): void { this.listeners = [] }
}

export const Uri = {
  file: (fsPath: string) => ({ scheme: 'file', fsPath, path: fsPath.replace(/\\/g, '/'), toString: () => `file://${fsPath}` }),
}
