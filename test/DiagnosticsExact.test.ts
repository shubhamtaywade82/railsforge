import { describe, expect, it } from 'vitest'
import { DiagnosticsInfo, Finding, MIN_VSCODE_VERSION, compareVersions, evaluateDiagnostics, renderDiagnosticsDoc } from '../src/diagnostics/Diagnostics'

function healthy(): DiagnosticsInfo {
  return {
    extension: { id: 'ShubhamTaywade.railsforge', version: '0.2.0' },
    host: { vscodeVersion: '1.140.0', appName: 'Visual Studio Code', trusted: true },
    runtime: { platform: 'linux', arch: 'x64', node: '22.22.0', electron: '39.0.0', napi: '10' },
    astIndex: { supported: true, roots: { '/p': 'ready' } },
    nativeModules: [{ name: 'better-sqlite3', platformKey: 'linux-x64', prebuildPresent: true, loaded: true }],
    project: { root: '/p', rubyVersion: '3.3.6', railsVersion: '8.0.1', projectType: 'monolith', testFramework: 'rspec', versionManager: 'mise', launcher: 'bin/ stubs' },
    tools: { rubyLsp: true, rdbg: true },
    skills: { sha: 'dd22f25b435c40e38b28bd5226ef810adf1f4edc', skillCount: 87 },
    ai: { provider: 'ollama', model: 'qwen2.5-coder:14b', hasApiKey: false },
  }
}
const find = (fs: Finding[], area: string, level?: string) => fs.filter(f => f.area === area && (!level || f.level === level))

describe('compareVersions edge cases', () => {
  it('compares across different segment counts and non-numeric parts', () => {
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0)
    expect(compareVersions('1.2.1', '1.2')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0', '1.2')).toBe(0)
    expect(compareVersions('1.x.3', '1.0.3')).toBe(0)
  })
  it('treats exactly the minimum as supported', () => {
    expect(evaluateDiagnostics({ ...healthy(), host: { ...healthy().host, vscodeVersion: MIN_VSCODE_VERSION } })[0]).toMatchObject({ level: 'ok', area: 'Host' })
  })
})

describe('evaluateDiagnostics: every branch emits exactly its finding', () => {
  it('healthy host yields precise ok findings in order', () => {
    const fs = evaluateDiagnostics(healthy())
    expect(fs.map(f => `${f.level}:${f.area}`)).toEqual(['ok:Host', 'ok:Native', 'ok:AST index', 'ok:Project', 'ok:Skills', 'ok:AI'])
    expect(fs[0].message).toBe(`VS Code 1.140.0 (minimum ${MIN_VSCODE_VERSION}).`)
    expect(fs[1].message).toBe('better-sqlite3 loads (linux-x64).')
    expect(fs[2].message).toBe('Ready/starting for 1 root(s).')
    expect(fs[3].message).toBe('Ruby 3.3.6.')
    expect(fs[4].message).toBe('87 skills (pack dd22f25b).')
    expect(fs[5].message).toBe('Provider "ollama", model "qwen2.5-coder:14b".')
  })

  it('old VS Code is an error, not an ok', () => {
    const fs = evaluateDiagnostics({ ...healthy(), host: { ...healthy().host, vscodeVersion: '1.95.9' } })
    expect(find(fs, 'Host')).toHaveLength(1)
    expect(find(fs, 'Host')[0]).toMatchObject({ level: 'error', fix: 'Update VS Code.' })
  })

  it('remote window adds an info finding only when remote', () => {
    expect(find(evaluateDiagnostics(healthy()), 'Host', 'info')).toHaveLength(0)
    const fs = evaluateDiagnostics({ ...healthy(), host: { ...healthy().host, remoteName: 'ssh-remote' } })
    expect(find(fs, 'Host', 'info')[0].message).toContain('ssh-remote')
  })

  it('native module states: missing prebuild, failed, skipped', () => {
    const base = healthy().nativeModules[0]
    const run = (m: Partial<typeof base>) => evaluateDiagnostics({ ...healthy(), nativeModules: [{ ...base, ...m }] }).filter(f => f.area === 'Native')
    expect(run({ prebuildPresent: false })).toEqual([expect.objectContaining({ level: 'warn', message: 'better-sqlite3 ships no prebuilt binary for linux-x64.' })])
    expect(run({ loaded: false, error: 'boom' })).toEqual([expect.objectContaining({ level: 'error', message: 'better-sqlite3 failed to load: boom' })])
    expect(run({ loaded: false })[0].message).toContain('unknown error')
    expect(run({ loaded: 'skipped' })).toEqual([expect.objectContaining({ level: 'info' })])
  })

  it('AST index: failed roots error, empty roots ok, unsupported warns with reason', () => {
    const ast = (a: DiagnosticsInfo['astIndex']) => find(evaluateDiagnostics({ ...healthy(), astIndex: a }), 'AST index')
    expect(ast({ supported: true, roots: { '/a': 'failed', '/b': 'ready', '/c': 'failed' } })).toEqual([expect.objectContaining({ level: 'error', message: 'The index failed to start for 2 project root(s).' })])
    expect(ast({ supported: true, roots: {} })).toEqual([expect.objectContaining({ level: 'ok', message: 'Supported; starts when a Ruby project is opened.' })])
    expect(ast({ supported: false, reason: 'Node 22.5', roots: {} })).toEqual([expect.objectContaining({ level: 'warn', message: 'Unavailable — Node 22.5.' })])
    expect(ast({ supported: false, roots: {} })[0].message).toBe('Unavailable — unsupported runtime.')
  })

  it('project: none, unknown ruby, rails type with unknown rails version', () => {
    const proj = (p: Partial<DiagnosticsInfo['project']>) => find(evaluateDiagnostics({ ...healthy(), project: { ...healthy().project, ...p } }), 'Project')
    expect(proj({ root: undefined })).toEqual([expect.objectContaining({ level: 'info' })])
    expect(proj({ rubyVersion: 'unknown' })).toEqual([expect.objectContaining({ level: 'warn' })])
    expect(proj({ railsVersion: 'unknown' }).map(f => f.level)).toEqual(['ok', 'warn'])
    expect(proj({ railsVersion: 'unknown', projectType: 'api_only' }).map(f => f.level)).toEqual(['ok', 'warn'])
    expect(proj({ railsVersion: 'unknown', projectType: 'gem' }).map(f => f.level)).toEqual(['ok'])
  })

  it('tools and skills and AI key warnings', () => {
    expect(find(evaluateDiagnostics({ ...healthy(), tools: { rubyLsp: false, rdbg: true } }), 'Tools')).toHaveLength(1)
    expect(find(evaluateDiagnostics({ ...healthy(), tools: { rubyLsp: true, rdbg: false } }), 'Tools')).toHaveLength(1)
    expect(find(evaluateDiagnostics({ ...healthy(), tools: { rubyLsp: false, rdbg: false } }), 'Tools')).toHaveLength(2)
    expect(find(evaluateDiagnostics(healthy()), 'Tools')).toHaveLength(0)
    expect(find(evaluateDiagnostics({ ...healthy(), skills: undefined }), 'Skills')).toEqual([expect.objectContaining({ level: 'warn' })])
    for (const provider of ['openai', 'anthropic']) {
      expect(find(evaluateDiagnostics({ ...healthy(), ai: { provider, model: 'm', hasApiKey: false } }), 'AI', 'warn')).toHaveLength(1)
      expect(find(evaluateDiagnostics({ ...healthy(), ai: { provider, model: 'm', hasApiKey: true } }), 'AI', 'ok')).toHaveLength(1)
    }
    expect(find(evaluateDiagnostics({ ...healthy(), ai: { provider: 'ollama', model: 'm', hasApiKey: false } }), 'AI', 'warn')).toHaveLength(0)
  })
})

describe('renderDiagnosticsDoc exact output', () => {
  it('summarises counts and renders findings with icons and fixes', () => {
    const info = { ...healthy(), host: { ...healthy().host, trusted: false, vscodeVersion: '1.90.0', remoteName: 'wsl' } }
    const doc = renderDiagnosticsDoc(info)
    expect(doc).toContain('**1 error(s), 1 warning(s).**')
    expect(doc).not.toContain('Everything looks healthy')
    expect(doc).toContain('- ❌ **Host:** VS Code 1.90.0 is older than the supported minimum 1.96.0. _Fix: Update VS Code._')
    expect(doc).toContain('- ⚠️ **Trust:**')
    expect(doc).toContain('- ℹ️ **Host:** Running in a remote window (wsl)')
    expect(doc).toContain('| VS Code | 1.90.0 (Visual Studio Code) — remote: wsl |')
    expect(doc).toContain('| Workspace trust | Restricted Mode |')
  })

  it('healthy report has icons, environment and project tables and per-root AST list', () => {
    const doc = renderDiagnosticsDoc(healthy())
    expect(doc.startsWith('# RailsForge diagnostics\n\n**Everything looks healthy.**\n\n## Findings\n\n- ✅ **Host:**')).toBe(true)
    for (const row of [
      '| Extension | ShubhamTaywade.railsforge 0.2.0 |', '| VS Code | 1.140.0 (Visual Studio Code) |', '| Platform | linux-x64 |',
      '| Node / Electron | 22.22.0 / 39.0.0 (N-API 10) |', '| Workspace trust | trusted |', '| Root | /p |', '| Type | monolith |', '| Ruby | 3.3.6 |',
      '| Rails | 8.0.1 |', '| Tests | rspec |', '| Version manager | mise |', '| Tool launcher | bin/ stubs |',
      'API key not stored (the key itself is never shown).', '- `/p` — ready',
    ]) { expect(doc, row).toContain(row) }
  })

  it('omits optional parts: no electron, no root, no roots, key stored', () => {
    const info = { ...healthy(), runtime: { ...healthy().runtime, electron: undefined }, project: { ...healthy().project, root: undefined }, astIndex: { supported: true, roots: {} }, ai: { ...healthy().ai, hasApiKey: true } }
    const doc = renderDiagnosticsDoc(info)
    expect(doc).toContain('| Node / Electron | 22.22.0 (N-API 10) |')
    expect(doc).toContain('| Root | — |')
    expect(doc).not.toContain('## AST index per root')
    expect(doc).toContain('API key stored')
  })
})
