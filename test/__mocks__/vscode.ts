export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
}

export class Range {
  start: Position
  end: Position
  constructor(
    public startLine: number,
    public startChar: number,
    public endLine: number,
    public endChar: number,
  ) {
    this.start = new Position(startLine, startChar)
    this.end = new Position(endLine, endChar)
  }
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
  appendCodeblock(code: string, _language?: string) {
    this.value += `\`\`\`${_language ?? ''}\n${code}\n\`\`\`\n`
    return this
  }
}

export class Hover {
  constructor(
    public contents: MarkdownString,
    public range?: Range,
  ) {}
}

export class TextEdit {
  public newText: string
  constructor(
    public range: Range,
    newText: string,
  ) {
    this.newText = newText
    }
}

export class ThemeIcon {
  constructor(public id: string) {}
}

export class TreeItem {
  public label?: string
  public description?: string
  public tooltip?: string
  public iconPath?: unknown
  public contextValue?: string
  public command?: unknown
  constructor(
    labelOrUndefined?: string,
    public collapsibleState?: number,
    description?: string,
    iconPath?: unknown,
  ) {
    this.label = labelOrUndefined
  }
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
}

export class EventEmitter<T = void> {
  private listeners: Array<(e: T) => void> = []
  readonly event = (listener: (e: T) => void): { dispose(): void } => {
    this.listeners.push(listener)
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener) } }
  }
  fire(e?: T): void { for (const l of this.listeners) { l(e as T) } }
  dispose(): void { this.listeners = [] }
}

export class Selection {
  constructor(
    public startLine: number,
    public startChar: number,
    public endLine: number,
    public endChar: number,
  ) {}
}

export class CodeActionContext {
  constructor(public diagnostics: Diagnostic[]) {}
}

export class WorkspaceEdit {
  readonly operations: Array<{ kind: string; uri?: unknown; range?: unknown; position?: unknown; newText?: string; options?: unknown; oldUri?: unknown; newUri?: unknown }> = []
  public _edits: Array<{ uri: unknown; range?: Range; text: string; position?: Position }> = []
  replace(uri: unknown, range: unknown, newText: string): void {
    this.operations.push({ kind: 'replace', uri, range, newText })
    this._edits.push({ uri, range: range as Range, text: newText })
  }
  insert(uri: unknown, position: unknown, newText: string): void {
    this.operations.push({ kind: 'insert', uri, position, newText })
    this._edits.push({ uri, position: position as Position, text: newText })
  }
  delete(uri: unknown, range: unknown): void {
    this.operations.push({ kind: 'delete', uri, range })
    this._edits.push({ uri, range: range as Range, text: '' })
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

export class Uri {
  public fsPath: string
  constructor(fsPath: string) {
    this.fsPath = fsPath
  }
  get path(): string {
    return this.fsPath.replace(/\\/g, '/')
  }
  static file(path: string): Uri {
    return new Uri(path)
  }
  static parse(value: string): Uri {
    return new Uri(value)
  }
  toString(): string {
    return this.fsPath
  }
}

export class TextLine {
  constructor(public text: string, public _lineNumber?: number) {}
}

export class TextDocument {
  public uri: Uri
  public fileName: string
  public languageId: string
  public isUntitled = false
  private _text: string
  private _lines: TextLine[]

  constructor(fileName: string, languageId: string, text: string) {
    this.fileName = fileName
    this.languageId = languageId
    this.uri = new Uri(fileName)
    this._text = text
    this._lines = text.split('\n').map((t, i) => new TextLine(t, i))
    this.lineCount = this._lines.length
  }

  getText(range?: Range): string {
    if (!range) {return this._text}
    const lines = this._text.split('\n')
    if (range.startLine === range.endLine) {
      return lines[range.startLine].slice(range.startChar, range.endChar)
    }
    const result: string[] = []
    for (let i = range.startLine; i <= range.endLine; i++) {
      if (i === range.startLine) {
        result.push(lines[i].slice(range.startChar))
      } else if (i === range.endLine) {
        result.push(lines[i].slice(0, range.endChar))
      } else {
        result.push(lines[i])
      }
    }
    return result.join('\n')
  }

  lineAt(lineOrNumber: number | { line: number } | TextLine): TextLine {
    if (typeof lineOrNumber === 'number') {
      return this._lines[lineOrNumber] ?? new TextLine('', lineOrNumber)
    }
    if ('line' in lineOrNumber) {
      return this._lines[lineOrNumber.line] ?? new TextLine('', lineOrNumber.line)
    }
    return lineOrNumber
  }

  lineCount: number = 0
  getWordRangeAtPosition(_position: Position, _regex?: RegExp): Range | null {
    return null
  }

  positionAt(offset: number): Position {
    let count = 0
    for (let i = 0; i < this._lines.length; i++) {
      if (count + this._lines[i].text.length + 1 > offset) {
        return new Position(i, offset - count)
      }
      count += this._lines[i].text.length + 1
    }
    return new Position(this._lines.length - 1, 0)
  }
}

export class Location {
  constructor(public uri: Uri, public range: Range | Position) {}
}

export class CodeLens {
  constructor(
    public range: Range,
    public command?: { title: string; command: string; arguments?: unknown[] },
  ) {}
}

export class SnippetString {
  constructor(public value: string) {}
}

export class TestMessage {
  constructor(public message: string) {}
}

function testItemChildren(owner: TestItem) {
  let items: TestItem[] = []
  return {
    add(child: TestItem) {
      child.parent = owner
      items.push(child)
    },
    replace(children: TestItem[]) {
      items = children
      for (const child of children) { child.parent = owner }
    },
    forEach(cb: (child: TestItem) => void) {
      items.forEach(cb)
    },
    get size() {
      return items.length
    },
  }
}

export class TestItem {
  public range?: Range
  public uri?: Uri
  public label: string
  public parent?: TestItem
  public canResolveChildren = false
  public children = testItemChildren(this)
  constructor(
    public id: string,
    label: string,
    uri?: Uri,
  ) {
    this.label = label
    this.uri = uri
  }
}

export class TestRun {
  started(_test: TestItem) {}
  passed(_test: TestItem) {}
  failed(_test: TestItem, _message: TestMessage) {}
  appendOutput(_value: string) {}
  end() {}
}

export class TestController {
  private readonly itemMap = new Map<string, TestItem>()
  public items = {
    get: (id: string) => this.itemMap.get(id),
    add: (item: TestItem) => { this.itemMap.set(item.id, item) },
    delete: (id: string) => { this.itemMap.delete(id) },
    forEach: (cb: (item: TestItem) => void) => { this.itemMap.forEach(cb) },
  }
  createTestItem(id: string, label: string, uri?: Uri): TestItem {
    return new TestItem(id, label, uri)
  }
  createTestRun(_request: unknown): TestRun {
    return new TestRun()
  }
  createRunProfile(_label: string, _kind: unknown, _handler: unknown, _isDefault?: boolean) {}
  dispose() {}
}

export const TestRunProfileKind = { Run: 1 }

export class CancellationToken {
  public isCancellationRequested = false
}

export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 }

export class RelativePattern {
  constructor(
    public base: string | { fsPath: string },
    public pattern: string,
  ) {}
}

export class TestRunRequest {
  public include?: TestItem[]
}

export const TextEditorRevealType = { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 }

const _configData: Record<string, Record<string, unknown>> = {}
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
  onDidChangeWorkspaceFolders: (
    _handler: (event: unknown) => void,
    _thisArgs?: unknown,
    disposables?: Array<{ dispose(): void }>,
  ): { dispose(): void } => {
    const d = { dispose: () => {} }
    if (disposables) {disposables.push(d)}
    return d
  },
  onDidGrantWorkspaceTrust: (
    _handler: () => void,
    _thisArgs?: unknown,
    disposables?: Array<{ dispose(): void }>,
  ): { dispose(): void } => {
    const d = { dispose: () => {} }
    if (disposables) {disposables.push(d)}
    return d
  },
  isWorkspaceTrusted: true,
  isTrusted: true,
  registerTextDocumentContentProvider: () => ({ dispose: () => {} }),
  workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }] as unknown[],
  getWorkspaceFolder: (_uri: unknown) => undefined,
  asRelativePath: (uri: Uri) => uri.fsPath.split('/').pop() ?? uri.fsPath,
  openTextDocument: (uriOrOptions: Uri | { content: string; language?: string }) => {
    if (uriOrOptions && typeof uriOrOptions === 'object' && 'content' in uriOrOptions) {
      return Promise.resolve(new TextDocument('untitled', uriOrOptions.language ?? 'ruby', uriOrOptions.content))
    }
    const uri = uriOrOptions as Uri
    return Promise.resolve(new TextDocument(uri.fsPath, 'ruby', ''))
  },
  findFiles: (_include: string, _exclude?: string) => Promise.resolve([] as Uri[]),
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T => (_configData[`${section}.${key}`] as T) ?? (defaultValue as T),
    inspect: <T>(key: string) => ({ workspaceValue: _configData[`${section}.${key}`] as T ?? undefined }),
    update: (_key: string, _value: unknown) => Promise.resolve(),
  }),
  fs: {
    writeFile: (_uri: Uri, _content: Uint8Array) => Promise.resolve(),
    readFile: (_uri: Uri) => Promise.resolve(new Uint8Array()),
  },
  applyEdit: (_edit: WorkspaceEdit) => Promise.resolve(true),
}

export const window = {
  createTreeView: () => ({ dispose: () => {} }),
  createTerminal: () => ({ sendText: () => {}, show: () => {}, dispose: () => {} }),
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
  activeTextEditor: undefined as unknown,
  showWarningMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  showQuickPick: () => Promise.resolve(undefined),
  showInputBox: () => Promise.resolve(undefined),
  showInformationMessage: () => Promise.resolve(undefined),
  showTextDocument: () => Promise.resolve(undefined),
}

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: () => Promise.resolve(),
}

export const extensions = {
  getExtension: (_id: string) => undefined,
}

export const tests = {
  createTestController: (_id: string, _label: string) => new TestController(),
}

export const languages = {
  createDiagnosticCollection: () => ({
    set: () => {},
    delete: () => {},
    dispose: () => {},
  }),
  getDiagnostics: () => [] as Diagnostic[],
}

export type ProviderResult<T> = T | Promise<T> | undefined

export interface WebviewViewProvider {
  resolveWebviewView(webviewView: WebviewView): void
}

export class Webview {
  public options: { enableScripts: boolean; localResourceRoots: Uri[] } = { enableScripts: false, localResourceRoots: [] }
  public html = ''
  private _messageListener: ((msg: unknown) => unknown) | null = null
  onDidReceiveMessage(listener: (msg: unknown) => unknown) { this._messageListener = listener; return { dispose: () => { this._messageListener = null } } }
  async postMessage(_msg: unknown): Promise<boolean> { return true }
  /** Simulate a message from the webview (for testing) */
  simulateMessage(msg: unknown) { if (this._messageListener) { return this._messageListener(msg) } }
}

export class WebviewView {
  public webview = new Webview()
}

export interface ChatResponseStream {
  progress(text: string): void
  markdown(markdown: string | MarkdownString): void
  button(button: { command: string; title: string; arguments?: unknown[] }): void
}

export interface ChatRequest {
  prompt: string
  command?: string
}

export const chat = {
  createChatParticipant: (_id: string, _handler: (request: ChatRequest, _ctx: unknown, stream: ChatResponseStream) => Promise<unknown>) => {
    return { dispose: () => {} }
  },
}
