import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from 'vscode'
import { DevDocsPanel } from '../src/docs/DevDocsPanel'

const BASE_URL = 'https://devdocs.io'

describe('DevDocsPanel', () => {
  let webviewPanel: any
  let postMessageSpy: ReturnType<typeof vi.fn>
  let disposeSpy: ReturnType<typeof vi.fn>
  let onDidDisposeFn: ((cb: () => void) => void) | null

  beforeEach(() => {
    vi.restoreAllMocks()
    DevDocsPanel['currentPanel'] = undefined

    postMessageSpy = vi.fn().mockResolvedValue(undefined)
    onDidDisposeFn = null
    disposeSpy = vi.fn()

    webviewPanel = {
      webview: {
        html: '',
        postMessage: postMessageSpy,
      },
      reveal: vi.fn(),
      dispose: disposeSpy,
      onDidDispose: (cb: () => void, _ctx: any, disposables: any[]) => {
        onDidDisposeFn = cb
        if (disposables) disposables.push({ dispose: () => {} })
      },
    }

    vscode.window.createWebviewPanel = vi.fn().mockReturnValue(webviewPanel)
    vscode.window.activeTextEditor = undefined
    vscode['ViewColumn'] = { One: 1, Two: 2, Three: 3, Beside: 2 }
  })

  it('creates a new panel when no panel exists', () => {
    DevDocsPanel.createOrShow(BASE_URL, false)

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'railsforge.devdocs',
      'DevDocs',
      1, // ViewColumn.One
      { enableScripts: true, retainContextWhenHidden: true },
    )
    expect(DevDocsPanel['currentPanel']).toBeDefined()
  })

  it('reveals existing panel instead of creating a new one', () => {
    DevDocsPanel.createOrShow(BASE_URL, false)
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1)

    DevDocsPanel.createOrShow(BASE_URL, false)
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(webviewPanel.reveal).toHaveBeenCalledTimes(1)
  })

  it('uses ViewColumn.Beside when openBesideActiveEditor is true', () => {
    DevDocsPanel.createOrShow(BASE_URL, true)

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'railsforge.devdocs',
      'DevDocs',
      2, // ViewColumn.Beside
      { enableScripts: true, retainContextWhenHidden: true },
    )
  })

  it('uses activeTextEditor viewColumn when available', () => {
    vscode.window.activeTextEditor = { viewColumn: 3 } as any
    DevDocsPanel.createOrShow(BASE_URL, false)

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'railsforge.devdocs',
      'DevDocs',
      3,
      { enableScripts: true, retainContextWhenHidden: true },
    )
  })

  it('sets initial webview HTML with iframe pointing to baseUrl', () => {
    DevDocsPanel.createOrShow(BASE_URL, false)

    const html = webviewPanel.webview.html
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('iframe')
    expect(html).toContain('src="https://devdocs.io"')
  })

  it('includes search term in initial iframe src when term is provided', () => {
    DevDocsPanel.createOrShow(BASE_URL, false, 'ActiveRecord')

    const html = webviewPanel.webview.html
    expect(html).toContain('src="https://devdocs.io/#q=ActiveRecord"')
  })

  it('encodes search term in iframe src using encodeURIComponent', () => {
    DevDocsPanel.createOrShow(BASE_URL, false, 'foo & "bar"')

    const html = webviewPanel.webview.html
    expect(html).toContain('%26')
    expect(html).toContain('%22')
  })

  it('includes nonce in Content-Security-Policy and script tag', () => {
    DevDocsPanel.createOrShow(BASE_URL, false)

    const html = webviewPanel.webview.html
    // Extract nonce from CSP header
    const cspMatch = html.match(/script-src 'nonce-([A-Za-z0-9]+)'/)
    expect(cspMatch).not.toBeNull()
    // Verify same nonce appears in script tag
    expect(html).toContain(`nonce="${cspMatch![1]}"`)
  })

  it('includes frame-src CSP with correct origin', () => {
    DevDocsPanel.createOrShow(BASE_URL, false)

    const html = webviewPanel.webview.html
    expect(html).toContain('frame-src https://devdocs.io')
  })

  it('searches existing panel when createOrShow is called with term on existing panel', () => {
    DevDocsPanel.createOrShow(BASE_URL, false)
    postMessageSpy.mockClear()

    DevDocsPanel.createOrShow(BASE_URL, false, 'has_many')
    expect(postMessageSpy).toHaveBeenCalledWith({ type: 'search', term: 'has_many' })
  })

  it('generates HTML with message listener script', () => {
    DevDocsPanel.createOrShow(BASE_URL, false)

    const html = webviewPanel.webview.html
    expect(html).toContain("window.addEventListener('message'")
    expect(html).toContain('message.type === \'search\'')
  })

  it('generates nonce of length 32', () => {
    DevDocsPanel.createOrShow(BASE_URL, false)

    const html = webviewPanel.webview.html
    const nonceMatch = html.match(/nonce-([A-Za-z0-9]{32})/)
    expect(nonceMatch).not.toBeNull()
  })

  it('disposes panel and clears static reference on dispose callback', () => {
    DevDocsPanel.createOrShow(BASE_URL, false)
    expect(DevDocsPanel['currentPanel']).toBeDefined()

    onDidDisposeFn!()
    expect(DevDocsPanel['currentPanel']).toBeUndefined()
    expect(disposeSpy).toHaveBeenCalled()
  })

  it('embeds baseUrl as JSON in the script for search navigation', () => {
    DevDocsPanel.createOrShow(BASE_URL, false)

    const html = webviewPanel.webview.html
    expect(html).toContain(JSON.stringify(BASE_URL))
  })

  it('escapes ampersands in baseUrl for HTML attribute safety', () => {
    DevDocsPanel.createOrShow('https://devdocs.io&a=b', false)

    const html = webviewPanel.webview.html
    expect(html).toContain('src="https://devdocs.io&amp;a=b"')
  })
})
