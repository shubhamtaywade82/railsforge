import { describe, expect, it } from 'vitest'
import { DiagnosticsInfo, compareVersions, evaluateDiagnostics, renderDiagnosticsDoc } from '../src/diagnostics/Diagnostics'

function healthy(): DiagnosticsInfo {
  return {
    extension: { id: 'ShubhamTaywade.railsforge', version: '0.2.0' },
    host: { vscodeVersion: '1.140.0', appName: 'Visual Studio Code', trusted: true },
    runtime: { platform: 'linux', arch: 'x64', node: '22.22.0', electron: '39.0.0', napi: '10' },
    astIndex: { supported: true, roots: { '/p': 'ready' } },
    nativeModules: [
      { name: 'better-sqlite3', platformKey: 'linux-x64', prebuildPresent: true, loaded: true },
      { name: 'tree-sitter', platformKey: 'linux-x64', prebuildPresent: true, loaded: true },
    ],
    project: { root: '/p', rubyVersion: '3.3.6', railsVersion: '8.0.1', projectType: 'monolith', testFramework: 'rspec', versionManager: 'mise', launcher: 'bin/ stubs' },
    tools: { rubyLsp: true, rdbg: true },
    skills: { sha: 'dd22f25b435c40e38b28bd5226ef810adf1f4edc', skillCount: 87 },
    ai: { provider: 'ollama', model: 'qwen2.5-coder:14b', hasApiKey: false },
  }
}

const levels = (info: DiagnosticsInfo) => evaluateDiagnostics(info).filter(f => f.level === 'warn' || f.level === 'error')

describe('compareVersions', () => {
  it.each([
    ['1.96.0', '1.96.0', 0],
    ['1.140.0', '1.96.0', 1],
    ['1.95.9', '1.96.0', -1],
    ['2', '1.99.99', 1],
  ])('%s vs %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign)
  })
})

describe('evaluateDiagnostics', () => {
  it('reports a healthy environment with no warnings or errors', () => {
    expect(levels(healthy())).toEqual([])
    expect(renderDiagnosticsDoc(healthy())).toContain('Everything looks healthy')
  })

  it('errors on a VS Code older than the supported minimum', () => {
    const info = { ...healthy(), host: { ...healthy().host, vscodeVersion: '1.90.2' } }
    expect(levels(info).map(f => f.area)).toContain('Host')
    expect(levels(info)[0].level).toBe('error')
  })

  it('warns in Restricted Mode and explains what is disabled', () => {
    const info = { ...healthy(), host: { ...healthy().host, trusted: false } }
    const f = levels(info).find(x => x.area === 'Trust')
    expect(f?.message).toMatch(/Restricted Mode/)
    expect(f?.fix).toMatch(/Workspace Trust/)
  })

  it('warns (not errors) when the AST index is unsupported, with the reason', () => {
    const info = { ...healthy(), astIndex: { supported: false, reason: 'N-API 9', roots: {} } }
    const f = levels(info).find(x => x.area === 'AST index')
    expect(f).toMatchObject({ level: 'warn' })
    expect(f?.message).toContain('N-API 9')
  })

  it('distinguishes a missing prebuild (warn) from a load failure (error) and a deliberate skip (info)', () => {
    const info = healthy()
    info.nativeModules = [
      { name: 'tree-sitter', platformKey: 'linux-arm64', prebuildPresent: false, loaded: false },
      { name: 'better-sqlite3', platformKey: 'linux-arm64', prebuildPresent: true, loaded: false, error: 'dlopen failed' },
      { name: 'tree-sitter-ruby', platformKey: 'linux-arm64', prebuildPresent: true, loaded: 'skipped' },
    ]
    const found = evaluateDiagnostics(info).filter(f => f.area === 'Native')
    expect(found.map(f => f.level)).toEqual(['warn', 'error', 'info'])
    expect(found[1].message).toContain('dlopen failed')
  })

  it('flags an undeclared Ruby version and an undetectable Rails version', () => {
    const info = { ...healthy(), project: { ...healthy().project, rubyVersion: 'unknown', railsVersion: 'unknown' } }
    const msgs = levels(info).map(f => f.message).join('\n')
    expect(msgs).toMatch(/No Ruby version is declared/)
    expect(msgs).toMatch(/Rails version could not be determined/)
  })

  it('warns when a hosted AI provider has no key, and never prints the key itself', () => {
    const info = { ...healthy(), ai: { provider: 'openai', model: 'gpt-4o-mini', hasApiKey: false } }
    expect(levels(info).some(f => f.area === 'AI')).toBe(true)
    const doc = renderDiagnosticsDoc({ ...info, ai: { ...info.ai, hasApiKey: true } })
    expect(doc).toContain('API key stored')
    expect(doc).not.toMatch(/sk-/)
  })

  it('degrades gracefully with no active project or skills pack', () => {
    const info = healthy()
    info.project = { ...info.project, root: undefined }
    info.skills = undefined
    const findings = evaluateDiagnostics(info)
    expect(findings.some(f => f.area === 'Project' && f.level === 'info')).toBe(true)
    expect(findings.some(f => f.area === 'Skills' && f.level === 'warn')).toBe(true)
  })

  it('renders environment, project and per-root AST state', () => {
    const doc = renderDiagnosticsDoc(healthy())
    expect(doc).toContain('| Platform | linux-x64 |')
    expect(doc).toContain('| Ruby | 3.3.6 |')
    expect(doc).toContain('`/p` — ready')
  })
})
