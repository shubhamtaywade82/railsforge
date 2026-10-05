/**
 * RailsChatViewProvider - Sidebar webview chat with slash-command picker,
 * @-mention context injection, and diff-aware code application.
 *
 * Code blocks now include an "Apply Diff" button (when the block looks like
 * a unified diff) and a "Replace File" button (when the block looks like a
 * full file). Both go through the same diff-preview flow as the CodeAction
 * lightbulb's AI fix: vscode.diff → user confirms → WorkspaceEdit.
 */

import * as vscode from 'vscode'
import { activeWorkspaceRoot } from '../workspace/activeRoot'
import { RailsAgent } from '../agent/RailsAgent'
import { SchemaIndexer } from '../rails/SchemaIndexer'
import { RoutesIndexer } from '../rails/RoutesIndexer'
import { Logger } from '../util/Logger'
import { applyDiffToFile, applyFullFileReplacement, createNewFile } from './ChatDiffApplier'

interface WebviewMessage {
  type: string
  prompt?: string
  code?: string
  mode?: 'replace' | 'insert' | 'create' | 'applyDiff' | 'replaceFile'
  fileName?: string
  includeContext?: boolean
}

export class RailsChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'railsforge.chatView'
  private view?: vscode.WebviewView

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly agent: RailsAgent,
    private readonly schemaIndexer: SchemaIndexer,
    private readonly routesIndexer: RoutesIndexer,
    private readonly patternNames: () => string[],
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] }
    webviewView.webview.html = this.getHtml()
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => this.handleMessage(msg))
    void this.postStatus()
  }

  public async sendExternalPrompt(prompt: string, options: { isolated?: boolean } = {}): Promise<void> {
    await vscode.commands.executeCommand('railsforge.chatView.focus')
    await this.processPrompt(prompt, !options.isolated, options.isolated)
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'webviewReady':
      case 'refreshStatus':
        await this.postStatus()
        break
      case 'sendPrompt':
        if (msg.prompt) { await this.processPrompt(msg.prompt, Boolean(msg.includeContext)) }
        break
      case 'applyCode':
        if (msg.code) { await this.applyCode(msg.code, msg.mode ?? 'replace', msg.fileName) }
        break
    }
  }

  private async postStatus(): Promise<void> {
    const status = await this.agent.getProviderStatus()
    const isOnline = status.state === 'reachable' || status.state === 'authenticated'
    const editor = vscode.window.activeTextEditor
    const currentFile = editor ? vscode.workspace.asRelativePath(editor.document.uri) : 'No file open'
    void this.view?.webview.postMessage({
      type: 'statusUpdate', isOnline, providerState: status.state, providerDetail: status.detail ?? '', currentFile,
      tablesCount: this.schemaIndexer.getAllTables().length,
      routesCount: this.routesIndexer.getAllRoutes().length,
    })
  }

  // Expands @mention tokens into grounded context blocks injected above the prompt.
  private buildMentionContext(prompt: string, activeCode: string): string {
    const has = (t: string) => new RegExp(`\\${t}\\b`).test(prompt)
    const parts: string[] = []

    if (has('@schema')) {
      const rows = this.schemaIndexer.getAllTables()
        .map(t => `- \`${t.name}\`: ${Array.from(t.columns.values()).map(c => `${c.name}:${c.type}`).join(', ')}`)
      parts.push(`### @schema (${rows.length} tables):\n${rows.join('\n')}`)
    }
    if (has('@routes')) {
      const rows = this.routesIndexer.getAllRoutes().slice(0, 40)
        .map((r: { verb: string; uriPattern: string; controller: string; action: string }) => `- ${r.verb} \`${r.uriPattern}\` → \`${r.controller}#${r.action}\``)
      parts.push(`### @routes:\n${rows.join('\n')}`)
    }
    if (has('@file') && activeCode) {
      parts.push(`### @file (active editor):\n\`\`\`ruby\n${activeCode}\n\`\`\``)
    }
    if (has('@patterns')) {
      const names = this.patternNames()
      parts.push(`### @patterns:\n${names.map(n => `- ${n}`).join('\n')}`)
    }
    return parts.join('\n\n')
  }

  private async processPrompt(prompt: string, includeContext: boolean, isolated = false): Promise<void> {
    const editor = vscode.window.activeTextEditor
    let activeCode = ''
    let fileName = ''
    let selection = ''

    if (includeContext && editor) {
      activeCode = editor.document.getText()
      fileName = editor.document.fileName
      selection = editor.document.getText(editor.selection)
    }

    void this.view?.webview.postMessage({ type: 'appendMessage', sender: 'user', text: prompt })
    void this.view?.webview.postMessage({ type: 'startStreaming' })
    Logger.info(`[Chat] "${prompt}"`)

    // Isolated prompts (pattern explanations) carry only their own text: no @mentions are expanded
    // and no project context is attached.
    const mentionCtx = isolated ? '' : this.buildMentionContext(prompt, activeCode)
    const cleanPrompt = isolated ? prompt : prompt.replace(/@(file|schema|routes|patterns)\b/g, '').trim()
    const groundedContent = mentionCtx ? `${mentionCtx}\n\n---\n\nUser: ${cleanPrompt}` : activeCode

    const result = await this.agent.run(cleanPrompt, isolated
      ? { isolated: true }
      : { fileContent: groundedContent, fileName, selection, workspaceRoot: activeWorkspaceRoot() })

    if (!result.success) { Logger.warn(`[Chat] error: ${result.response}`) }
    void this.view?.webview.postMessage({ type: 'appendMessage', sender: 'assistant', text: result.response, success: result.success })
    void this.view?.webview.postMessage({ type: 'stopStreaming' })
  }

  /**
   * Diff-aware code application. Supports 5 modes:
   * - insert: paste at cursor (legacy)
   * - replace: replace selection or paste at cursor
   * - create: write a new file
   * - applyDiff: parse as unified diff, preview, apply to active file
   * - replaceFile: preview full-file replacement, apply to active file
   */
  private async applyCode(code: string, mode: WebviewMessage['mode'], fileName?: string): Promise<void> {
    const root = activeWorkspaceRoot()

    // Create mode: write a new file
    if (mode === 'create') {
      if (!root) { return }
      const result = await createNewFile(code, root, fileName)
      vscode.window.showInformationMessage(result.message)
      return
    }

    // Apply Diff mode: parse as unified diff, show preview, apply
    if (mode === 'applyDiff') {
      const editor = vscode.window.activeTextEditor
      if (!editor) { vscode.window.showWarningMessage('No active editor — open a file first.'); return }
      const result = await applyDiffToFile(code, editor.document.uri, 'RailsForge AI Diff')
      vscode.window.showInformationMessage(result.message)
      return
    }

    // Replace File mode: show full-file diff preview, apply
    if (mode === 'replaceFile') {
      const editor = vscode.window.activeTextEditor
      if (!editor) { vscode.window.showWarningMessage('No active editor — open a file first.'); return }
      const result = await applyFullFileReplacement(code, editor.document.uri, 'RailsForge AI')
      vscode.window.showInformationMessage(result.message)
      return
    }

    // Legacy modes: insert/replace
    const editor = vscode.window.activeTextEditor
    if (!editor) { vscode.window.showWarningMessage('No active editor to insert code.'); return }
    await editor.edit(eb => {
      if (mode === 'replace' && !editor.selection.isEmpty) { eb.replace(editor.selection, code) }
      else { eb.insert(editor.selection.active, code) }
    })
    vscode.window.showInformationMessage('Code applied to active editor.')
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RailsForge AI Chat</title>
  <style>
    :root {
      --bg:var(--vscode-editor-background);--fg:var(--vscode-editor-foreground);
      --card-bg:var(--vscode-sideBar-background);--accent:#e11d48;--accent-h:#be123c;
      --border:var(--vscode-widget-border,#334155);--code-bg:var(--vscode-textCodeBlock-background,#0f172a);
      --input-bg:var(--vscode-input-background);--cmd:#60a5fa;--mention:#34d399;
      --popup-bg:var(--vscode-editorHoverWidget-background,#1e293b);
      --popup-bd:var(--vscode-editorHoverWidget-border,#334155);
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:var(--bg);color:var(--fg);font-family:var(--vscode-font-family,system-ui,sans-serif);
      font-size:13px;display:flex;flex-direction:column;height:100vh}
    .header{padding:10px 12px;border-bottom:1px solid var(--border);display:flex;
      align-items:center;justify-content:space-between;background:var(--card-bg)}
    .title-group{display:flex;align-items:center;gap:8px;font-weight:600}
    .status-pill{font-size:11px;padding:2px 8px;border-radius:12px;display:flex;
      align-items:center;gap:4px;background:rgba(16,185,129,.15);color:#10b981}
    .status-pill.offline{background:rgba(239,68,68,.15);color:#ef4444}
    .status-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
    .quick-actions{padding:8px 12px;display:flex;flex-wrap:wrap;gap:6px;
      border-bottom:1px solid var(--border);background:var(--bg)}
    .pill-btn{background:var(--card-bg);color:var(--fg);border:1px solid var(--border);
      padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;transition:all .15s}
    .pill-btn:hover{border-color:var(--accent);color:var(--accent)}
    .messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:12px}
    .message{padding:10px 12px;border-radius:8px;line-height:1.5;max-width:95%;word-break:break-word}
    .message.user{align-self:flex-end;background:var(--accent);color:#fff}
    .message.assistant{align-self:flex-start;background:var(--card-bg);border:1px solid var(--border)}
    .message pre{background:var(--code-bg);padding:8px;border-radius:6px;margin:8px 0;overflow-x:auto}
    .code-actions{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap}
    .code-actions button{background:var(--bg);border:1px solid var(--border);color:var(--fg);
      padding:2px 6px;border-radius:4px;font-size:10px;cursor:pointer}
    .code-actions button:hover{border-color:var(--accent);color:var(--accent)}
    .code-actions .btn-apply{border-color:var(--accent);color:var(--accent);font-weight:600}
    .input-container{padding:10px 12px;border-top:1px solid var(--border);
      background:var(--card-bg);display:flex;flex-direction:column;gap:8px}
    .context-row{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#94a3b8}
    .input-wrapper{position:relative}
    .input-highlight{position:absolute;inset:0;pointer-events:none;z-index:0;
      padding:8px;font-family:inherit;font-size:12px;line-height:1.5;white-space:pre-wrap;
      word-break:break-word;overflow:hidden;border-radius:6px;border:1px solid transparent;
      background:var(--input-bg)}
    .input-box{position:relative;z-index:1;width:100%;min-height:55px;max-height:120px;
      background:transparent;color:var(--fg);border:1px solid var(--border);border-radius:6px;
      padding:8px;resize:vertical;font-family:inherit;font-size:12px;line-height:1.5;caret-color:var(--fg)}
    .input-box:focus{outline:none;border-color:var(--accent)}
    .input-box:focus~.input-highlight{border-color:var(--accent)}
    .tok-cmd{color:var(--cmd);font-weight:600}
    .tok-mention{color:var(--mention);font-weight:600}
    .popup{display:none;position:absolute;bottom:calc(100% + 4px);left:0;right:0;
      background:var(--popup-bg);border:1px solid var(--popup-bd);border-radius:8px;
      overflow:hidden;z-index:100;box-shadow:0 4px 16px rgba(0,0,0,.4);max-height:220px;overflow-y:auto}
    .popup.visible{display:block}
    .popup-header{padding:5px 10px;font-size:10px;color:#64748b;border-bottom:1px solid var(--border)}
    .popup-item{padding:7px 10px;cursor:pointer;display:flex;align-items:baseline;gap:8px;transition:background .1s}
    .popup-item:hover,.popup-item.active{background:rgba(225,29,72,.18)}
    .popup-item-name{font-weight:600;font-size:12px}
    .popup-item-name.cmd{color:var(--cmd)}
    .popup-item-name.mention{color:var(--mention)}
    .popup-item-desc{font-size:11px;color:#94a3b8}
    .kb-hint{font-size:10px;color:#475569;padding:4px 10px;border-top:1px solid var(--border)}
    .send-row{display:flex;align-items:center;gap:8px}
    .send-btn{flex-shrink:0;background:var(--accent);color:#fff;border:none;padding:6px 14px;
      border-radius:6px;font-weight:500;cursor:pointer}
    .send-btn:hover{background:var(--accent-h)}
    .hint-text{font-size:10px;color:#475569}
  </style>
</head>
<body>
  <div class="header">
    <div class="title-group"><span>RailsForge AI</span></div>
    <div id="statusPill" class="status-pill">
      <span class="status-dot"></span><span id="statusText">Checking...</span>
    </div>
  </div>

  <div class="quick-actions">
    <button class="pill-btn" onclick="injectCmd('/service')">⚡ /service</button>
    <button class="pill-btn" onclick="injectCmd('/form')">📝 /form</button>
    <button class="pill-btn" onclick="injectCmd('/spec')">🧪 /spec</button>
    <button class="pill-btn" onclick="injectCmd('/optimize')">🚀 /optimize</button>
    <button class="pill-btn" onclick="injectCmd('/fix')">🔧 /fix</button>
    <button class="pill-btn" onclick="injectCmd('/explain')">🔍 /explain</button>
  </div>

  <div class="messages" id="messagesContainer">
    <div class="message assistant">
      Welcome to <strong>RailsForge AI</strong>.
      Type <span style="color:var(--cmd);font-weight:600">/command</span> or
      <span style="color:var(--mention);font-weight:600">@schema</span> /
      <span style="color:var(--mention);font-weight:600">@routes</span> /
      <span style="color:var(--mention);font-weight:600">@file</span> to inject context.
      Press <kbd style="font-size:10px;border:1px solid #475569;border-radius:3px;padding:1px 4px">Ctrl+/</kbd> to open commands.
    </div>
  </div>

  <div class="input-container">
    <div class="context-row">
      <label><input type="checkbox" id="includeContext" checked> Include active file context</label>
      <span id="activeFileLabel">Active File</span>
    </div>
    <div class="input-wrapper">
      <div id="popup" class="popup">
        <div class="popup-header" id="popupHeader">Commands</div>
        <div id="popupList"></div>
        <div class="kb-hint">↑↓ navigate · Enter/Tab select · Esc dismiss</div>
      </div>
      <textarea id="promptInput" class="input-box"
        placeholder="Ask anything... /command · @schema · @routes · @file · Ctrl+/ for picker"></textarea>
      <div class="input-highlight" id="inputHighlight" aria-hidden="true"></div>
    </div>
    <div class="send-row">
      <button class="send-btn" onclick="handleSend()">Send ↵</button>
      <span class="hint-text">Enter to send · Shift+Enter newline · Ctrl+/ commands</span>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messagesContainer');
    const inputEl    = document.getElementById('promptInput');
    const hlEl       = document.getElementById('inputHighlight');
    const includeCtx = document.getElementById('includeContext');
    const statusPill = document.getElementById('statusPill');
    const statusText = document.getElementById('statusText');
    const activeFileLbl = document.getElementById('activeFileLabel');
    const popup      = document.getElementById('popup');
    const popupList  = document.getElementById('popupList');
    const popupHdr   = document.getElementById('popupHeader');

    const COMMANDS = [
      {n:'/service', d:'Generate or extract a decoupled Service Object'},
      {n:'/form',    d:'Generate an ActiveModel Form Object'},
      {n:'/spec',    d:'Generate RSpec / Minitest tests for the active file'},
      {n:'/fix',     d:'Fix RuboCop, Brakeman, or RSpec failures'},
      {n:'/explain', d:'Explain active Ruby / Rails code or associations'},
      {n:'/scaffold',d:'Generate convention-compliant model + migration + controller'},
      {n:'/optimize',d:'Detect N+1 queries and suggest eager loading'},
      {n:'/migrate', d:'Generate a safe, reversible migration'},
    ];
    const MENTIONS = [
      {n:'@file',    d:'Inject the full current active file into context'},
      {n:'@schema',  d:'Inject database schema from db/schema.rb'},
      {n:'@routes',  d:'Inject route list from config/routes.rb'},
      {n:'@patterns',d:'Inject names of all indexed service/form/query objects'},
    ];

    let popupMode = null;
    let popupItems = [];
    let activeIdx = 0;
    let triggerStart = 0;

    // ── Highlight mirror ──
    function updateHighlight() {
      const raw = inputEl.value;
      const html = esc(raw)
        .replace(/(\\/[a-zA-Z]\\w*)/g, '<span class="tok-cmd">$1</span>')
        .replace(/(@[a-zA-Z]\\w*)/g,   '<span class="tok-mention">$1</span>');
      hlEl.innerHTML = html;
      hlEl.scrollTop = inputEl.scrollTop;
    }

    // ── Popup ──
    function showPopup(mode, items, query) {
      const filtered = items.filter(i => i.n.toLowerCase().startsWith(query.toLowerCase()));
      if (!filtered.length) { hidePopup(); return; }
      popupMode = mode; popupItems = filtered; activeIdx = 0;
      popupHdr.textContent = mode === 'cmd' ? 'Commands' : 'Context Mentions';
      popupList.innerHTML = filtered.map((item, i) =>
        '<div class="popup-item' + (i===0?' active':'') + '" data-idx="'+i+'">' +
          '<span class="popup-item-name '+(mode==='cmd'?'cmd':'mention')+'">'+esc(item.n)+'</span>' +
          '<span class="popup-item-desc">'+esc(item.d)+'</span>' +
        '</div>'
      ).join('');
      popup.classList.add('visible');
    }
    function hidePopup() { popup.classList.remove('visible'); popupMode=null; popupItems=[]; }

    function setActive(idx) {
      document.querySelectorAll('#popupList .popup-item').forEach((el,i)=>el.classList.toggle('active',i===idx));
      activeIdx = idx;
    }
    function selectItem(idx) {
      const item = popupItems[idx];
      if (!item) return;
      const val = inputEl.value;
      const before = val.slice(0, triggerStart);
      const after  = val.slice(inputEl.selectionStart);
      inputEl.value = before + item.n + ' ' + after;
      const pos = (before + item.n + ' ').length;
      inputEl.setSelectionRange(pos, pos);
      updateHighlight(); hidePopup(); inputEl.focus();
    }

    // ── Input events ──
    inputEl.addEventListener('input', () => {
      updateHighlight();
      const val = inputEl.value;
      const cur = inputEl.selectionStart ?? 0;
      const ws  = val.lastIndexOf(' ', cur-1)+1;
      const word = val.slice(ws, cur);
      triggerStart = ws;
      if (word.startsWith('/'))      showPopup('cmd',     COMMANDS, word);
      else if (word.startsWith('@')) showPopup('mention', MENTIONS, word);
      else hidePopup();
    });
    inputEl.addEventListener('scroll', () => { hlEl.scrollTop = inputEl.scrollTop; });

    inputEl.addEventListener('keydown', e => {
      if (popup.classList.contains('visible')) {
        if (e.key==='ArrowDown')         { e.preventDefault(); setActive((activeIdx+1)%popupItems.length); return; }
        if (e.key==='ArrowUp')           { e.preventDefault(); setActive((activeIdx-1+popupItems.length)%popupItems.length); return; }
        if (e.key==='Enter'||e.key==='Tab') { e.preventDefault(); selectItem(activeIdx); return; }
        if (e.key==='Escape')            { hidePopup(); return; }
      }
      if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); return; }
      if ((e.ctrlKey||e.metaKey) && e.key==='/') {
        e.preventDefault();
        const cur = inputEl.selectionStart ?? 0;
        inputEl.value = inputEl.value.slice(0,cur) + '/' + inputEl.value.slice(cur);
        inputEl.setSelectionRange(cur+1, cur+1);
        triggerStart = cur; updateHighlight(); showPopup('cmd', COMMANDS, '/');
      }
    });

    popupList.addEventListener('click', e => {
      const el = e.target.closest('.popup-item');
      if (el) selectItem(Number(el.dataset.idx));
    });

    function injectCmd(cmd) {
      inputEl.value = cmd + ' '; inputEl.focus();
      triggerStart = 0; updateHighlight(); showPopup('cmd', COMMANDS, cmd);
    }

    // ── Send ──
    function handleSend() {
      const text = inputEl.value.trim();
      if (!text) return;
      hidePopup();
      vscode.postMessage({ type:'sendPrompt', prompt:text, includeContext:includeCtx.checked });
      inputEl.value = ''; updateHighlight();
    }

    // ── Detect if text looks like a unified diff ──
    function isDiff(text) {
      return /^@@ -/m.test(text) || /^--- /m.test(text) || /^\\+\\+\\+ /m.test(text) || /^diff --git /m.test(text);
    }

    // ── Detect if text looks like a full file (has class/module defs) ──
    function isFullFile(text) {
      return text.split('\n').length > 10 && /^(?:class|module)\s+[A-Z]/m.test(text);
    }

    // ── Messages from extension host ──
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type==='statusUpdate') {
        statusPill.className = 'status-pill ' + (msg.isOnline ? '' : 'offline');
        var labels = { reachable: 'Ollama Online', authenticated: 'Provider Ready', unconfigured: 'No API key', error: 'Provider Error', offline: 'Offline' };
        statusText.textContent = labels[msg.providerState] || (msg.isOnline ? 'Online' : 'Offline');
        statusPill.title = msg.providerDetail || '';
        activeFileLbl.textContent = msg.currentFile;
      } else if (msg.type==='appendMessage') {
        appendMessage(msg.sender, msg.text);
      }
    });

    function appendMessage(sender, text) {
      const div = document.createElement('div');
      div.className = 'message ' + sender;
      const html = esc(text)
        .replace(/\x60\x60\x60([a-zA-Z0-9_-]*)\\n([\\s\\S]*?)\x60\x60\x60/g, function(_, lang, code) {
          const raw = code.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
          const enc = encodeURIComponent(raw);
          const diff = isDiff(raw);
          const fullFile = isFullFile(raw);
          let btns = '<button onclick="copyCode('+enc+')">📋 Copy</button>' +
                     '<button onclick="insertCode('+enc+')">📥 Insert</button>';
          if (diff) {
            btns = '<button class="btn-apply" onclick="applyCodeAction('+enc+',\'applyDiff\')">🔀 Apply Diff</button>' + btns;
          }
          if (fullFile && !diff) {
            btns = '<button class="btn-apply" onclick="applyCodeAction('+enc+',\'replaceFile\')">📄 Replace File</button>' + btns;
          }
          return '<pre><code>'+esc(raw)+'</code><div class="code-actions">'+btns+'</div></pre>';
        })
        .replace(/\\n/g, '<br>');
      div.innerHTML = html;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function copyCode(enc) { navigator.clipboard.writeText(decodeURIComponent(enc)); }
    function insertCode(enc) { vscode.postMessage({ type:'applyCode', code:decodeURIComponent(enc), mode:'insert' }); }
    function applyCodeAction(enc, mode) { vscode.postMessage({ type:'applyCode', code:decodeURIComponent(enc), mode: mode }); }
    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    vscode.postMessage({ type: 'webviewReady' });
  </script>
</body>
</html>`
  }
}
