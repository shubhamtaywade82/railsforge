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

export class CodeActionKind {
  constructor(public readonly value: string) {}
  append(parts: string): CodeActionKind {
    return new CodeActionKind(`${this.value}.${parts}`)
  }
  static readonly Empty = new CodeActionKind('')
  static readonly QuickFix = new CodeActionKind('QuickFix')
  static readonly Refactor = new CodeActionKind('Refactor')
  static readonly RefactorExtract = new CodeActionKind('RefactorExtract')
  static readonly RefactorRewrite = new CodeActionKind('RefactorRewrite')
  static readonly RefactorInline = new CodeActionKind('RefactorInline')
  static readonly Source = new CodeActionKind('Source')
  static readonly SourceFixAll = new CodeActionKind('SourceFixAll')
  static readonly SourceOrganizeImports = new CodeActionKind('SourceOrganizeImports')
}

export class MarkdownString {
  public isTrusted = false
  private value = ''
  appendMarkdown(str: string) {
    this.value += str
    return this
  }
}

/** Minimal WorkspaceEdit stub - records operations so tests can assert on them. */
export class WorkspaceEdit {
  readonly operations: Array<{ kind: string; uri?: unknown; range?: unknown; position?: unknown; newText?: string; options?: unknown; oldUri?: unknown; newUri?: unknown }> = []
  replace(uri: unknown, range: unknown, newText: string): void {
    this.operations.push({ kind: 'replace', uri, range, newText })
  }
  insert(uri: unknown, position: unknown, newText: string): void {
    this.operations.push({ kind: 'insert', uri, position, newText })
  }
  delete(uri: unknown, range: unknown): void {
    this.operations.push({ kind: 'delete', uri, range })
  }
  createFile(uri: unknown, options?: unknown): void {
    this.operations.push({ kind: 'createFile', uri, options })
  }
  renameFile(oldUri: unknown, newUri: unknown, options?: unknown): void {
    this.operations.push({ kind: 'renameFile', oldUri, newUri, options })
  }
  deleteFile(uri: unknown, options?: unknown): void {
    this.operations.push({ kind: 'deleteFile', uri, options })
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
    onDidCreate: () => {},
    onDidDelete: () => {},
    dispose: () => {},
  }),
  onDidSaveTextDocument: (
    _handler: (doc: unknown) => void,
    _thisArgs?: unknown,
    disposables?: Array<{ dispose(): void }>,
  ): { dispose(): void } => {
    const d = { dispose: () => {} }
    if (disposables) {disposables.push(d)}
    return d
  },
  onDidChangeConfiguration: (
    _handler: (event: unknown) => void,
    _thisArgs?: unknown,
    disposables?: Array<{ dispose(): void }>,
  ): { dispose(): void } => {
    const d = { dispose: () => {} }
    if (disposables) {disposables.push(d)}
    return d
  },
  getConfiguration: () => ({
    get: <T>(_key: string, defaultValue: T): T => defaultValue,
    update: async () => {},
  }),
  workspaceFolders: [] as unknown[],
  getWorkspaceFolder: (_uri: unknown) => undefined,
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
