/**
 * Diagnostics - turns facts about the host, runtime, native modules, project and AI setup into a
 * reviewable report ("RailsForge: Diagnose Environment") and a list of findings with fixes.
 * Pure (no vscode import): the collector in ./collect.ts gathers the facts, this file judges them.
 * Never includes secrets: AI settings are reduced to provider, model and whether a key exists.
 */

export const MIN_VSCODE_VERSION = '1.96.0'

export type FindingLevel = 'ok' | 'info' | 'warn' | 'error'

export interface Finding {
  level: FindingLevel
  area: string
  message: string
  fix?: string
}

export interface NativeModuleReport {
  name: string
  /** `<platform>-<arch>` this host needs a prebuilt binary for. */
  platformKey: string
  /** Prebuilt binary shipped in the package for this platform. */
  prebuildPresent: boolean
  /** true = loaded and exercised; false = failed; 'skipped' = deliberately not loaded (unsupported runtime). */
  loaded: boolean | 'skipped'
  error?: string
}

export interface DiagnosticsInfo {
  extension: { id: string; version: string }
  host: { vscodeVersion: string; appName: string; remoteName?: string; trusted: boolean }
  runtime: { platform: string; arch: string; node: string; electron?: string; napi: string }
  astIndex: { supported: boolean; reason?: string; roots: Record<string, string> }
  nativeModules: NativeModuleReport[]
  project: {
    root?: string
    rubyVersion: string
    railsVersion: string
    projectType: string
    testFramework: string
    versionManager: string
    launcher: string
  }
  tools: { rubyLsp: boolean; rdbg: boolean }
  skills?: { sha: string; skillCount: number }
  ai: { provider: string; model: string; hasApiKey: boolean }
}

/** Compares dotted numeric versions; returns <0, 0 or >0. Non-numeric parts compare as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(p => Number.parseInt(p, 10) || 0)
  const pb = b.split('.').map(p => Number.parseInt(p, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) {return d}
  }
  return 0
}

const UNKNOWN = 'unknown'

export function evaluateDiagnostics(info: DiagnosticsInfo): Finding[] {
  const findings: Finding[] = []
  const add = (level: FindingLevel, area: string, message: string, fix?: string): void => { findings.push({ level, area, message, fix }) }

  if (compareVersions(info.host.vscodeVersion, MIN_VSCODE_VERSION) < 0) {
    add('error', 'Host', `VS Code ${info.host.vscodeVersion} is older than the supported minimum ${MIN_VSCODE_VERSION}.`, 'Update VS Code.')
  } else {
    add('ok', 'Host', `VS Code ${info.host.vscodeVersion} (minimum ${MIN_VSCODE_VERSION}).`)
  }

  if (!info.host.trusted) {
    add('warn', 'Trust', 'This workspace is in Restricted Mode: commands that execute project code (tests, RuboCop, rake, generators, rails runner, analyzers, terminals) are disabled. Read-only features still work.', 'Run "Workspaces: Manage Workspace Trust" if you trust this folder.')
  }
  if (info.host.remoteName) {
    add('info', 'Host', `Running in a remote window (${info.host.remoteName}); native modules are loaded on the remote host, so the remote OS/arch matters.`)
  }

  for (const mod of info.nativeModules) {
    if (!mod.prebuildPresent) {
      add('warn', 'Native', `${mod.name} ships no prebuilt binary for ${mod.platformKey}.`, 'The AST index is unavailable on this platform; everything else works.')
    } else if (mod.loaded === false) {
      add('error', 'Native', `${mod.name} failed to load: ${mod.error ?? 'unknown error'}`, 'Reinstall the extension; if it persists, report this report on the issue tracker.')
    } else if (mod.loaded === 'skipped') {
      add('info', 'Native', `${mod.name} was not loaded because this runtime cannot support it (see AST index).`)
    } else {
      add('ok', 'Native', `${mod.name} loads (${mod.platformKey}).`)
    }
  }

  if (info.astIndex.supported) {
    const states = Object.values(info.astIndex.roots)
    const bad = states.filter(s => s === 'failed')
    if (bad.length > 0) {
      add('error', 'AST index', `The index failed to start for ${bad.length} project root(s).`, 'See the RailsForge output channel for the reason.')
    } else {
      add('ok', 'AST index', states.length > 0 ? `Ready/starting for ${states.length} root(s).` : 'Supported; starts when a Ruby project is opened.')
    }
  } else {
    add('warn', 'AST index', `Unavailable — ${info.astIndex.reason ?? 'unsupported runtime'}.`, '"Find Duplicate Methods" and "Show Dependency Cycles" are off; update VS Code to a build bundling Node 22.14+ to enable them.')
  }

  if (!info.project.root) {
    add('info', 'Project', 'No Ruby project is active (open a Ruby file or folder).')
  } else {
    if (info.project.rubyVersion === UNKNOWN) {
      add('warn', 'Project', 'No Ruby version is declared (.ruby-version, .tool-versions, Gemfile or Gemfile.lock). RailsForge will not assume one.', 'Add a .ruby-version file.')
    } else {
      add('ok', 'Project', `Ruby ${info.project.rubyVersion}.`)
    }
    const isRails = info.project.projectType === 'monolith' || info.project.projectType === 'api_only'
    if (isRails && info.project.railsVersion === UNKNOWN) {
      add('warn', 'Project', 'This looks like a Rails app but the Rails version could not be determined from Gemfile.lock.', 'Run `bundle install` so Gemfile.lock lists rails.')
    }
  }

  if (!info.tools.rubyLsp) {
    add('info', 'Tools', 'Shopify Ruby LSP is not installed; RailsForge complements it (Ruby facts) but works without it.', 'Install shopify.ruby-lsp for completion/definition/diagnostics.')
  }
  if (!info.tools.rdbg) {
    add('info', 'Tools', 'The Ruby debugger extension (KoichiSasada.vscode-rdbg) is not installed; "Debug" test profiles fall back to a terminal.')
  }

  if (!info.skills) {
    add('warn', 'Skills', 'The bundled ruby-agent-skills pack was not found; skill routing is disabled.', 'Reinstall the extension.')
  } else {
    add('ok', 'Skills', `${info.skills.skillCount} skills (pack ${info.skills.sha.slice(0, 8)}).`)
  }

  if ((info.ai.provider === 'openai' || info.ai.provider === 'anthropic') && !info.ai.hasApiKey) {
    add('warn', 'AI', `Provider is "${info.ai.provider}" but no API key is stored.`, 'Run "RailsForge: Set AI API Key".')
  } else {
    add('ok', 'AI', `Provider "${info.ai.provider}", model "${info.ai.model}".`)
  }

  return findings
}

const ICON: Record<FindingLevel, string> = { ok: '✅', info: 'ℹ️', warn: '⚠️', error: '❌' }

export function renderDiagnosticsDoc(info: DiagnosticsInfo, findings: readonly Finding[] = evaluateDiagnostics(info)): string {
  const lines: string[] = ['# RailsForge diagnostics', '']
  const counts = { error: 0, warn: 0 }
  for (const f of findings) {
    if (f.level === 'error') {counts.error++}
    if (f.level === 'warn') {counts.warn++}
  }
  lines.push(counts.error + counts.warn === 0 ? '**Everything looks healthy.**' : `**${counts.error} error(s), ${counts.warn} warning(s).**`, '')
  lines.push('## Findings', '')
  for (const f of findings) {
    lines.push(`- ${ICON[f.level]} **${f.area}:** ${f.message}${f.fix ? ` _Fix: ${f.fix}_` : ''}`)
  }
  lines.push(
    '', '## Environment', '',
    '| | |', '| --- | --- |',
    `| Extension | ${info.extension.id} ${info.extension.version} |`,
    `| VS Code | ${info.host.vscodeVersion} (${info.host.appName})${info.host.remoteName ? ` — remote: ${info.host.remoteName}` : ''} |`,
    `| Platform | ${info.runtime.platform}-${info.runtime.arch} |`,
    `| Node / Electron | ${info.runtime.node}${info.runtime.electron ? ` / ${info.runtime.electron}` : ''} (N-API ${info.runtime.napi}) |`,
    `| Workspace trust | ${info.host.trusted ? 'trusted' : 'Restricted Mode'} |`,
    '', '## Project', '',
    '| | |', '| --- | --- |',
    `| Root | ${info.project.root ?? '—'} |`,
    `| Type | ${info.project.projectType} |`,
    `| Ruby | ${info.project.rubyVersion} |`,
    `| Rails | ${info.project.railsVersion} |`,
    `| Tests | ${info.project.testFramework} |`,
    `| Version manager | ${info.project.versionManager} |`,
    `| Tool launcher | ${info.project.launcher} |`,
    '', '## AI', '',
    `Provider \`${info.ai.provider}\`, model \`${info.ai.model}\`, API key ${info.ai.hasApiKey ? 'stored' : 'not stored'} (the key itself is never shown).`,
    '',
  )
  const roots = Object.entries(info.astIndex.roots)
  if (roots.length > 0) {
    lines.push('## AST index per root', '', ...roots.map(([root, state]) => `- \`${root}\` — ${state}`), '')
  }
  return lines.join('\n')
}
