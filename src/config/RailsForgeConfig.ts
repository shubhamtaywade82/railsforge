/**
 * RailsForgeConfig - Single read point for every `railsForge.*` setting.
 *
 * All settings are declared with the default "window" scope in package.json,
 * which VS Code resolves from both the user's global settings.json and the
 * current workspace's `.vscode/settings.json` (workspace wins) — so every
 * setting here is configurable at either level without any extra code.
 *
 * Nothing here is cached: call `readConfig()` fresh at the point of use so a
 * settings change takes effect on the next action without requiring a reload.
 * For code that needs to react to a change proactively (e.g. re-running a
 * workspace scan when excludePatterns changes), subscribe via `onConfigChanged`.
 */

import * as vscode from 'vscode'
import { ApiDockMapping } from '../docs/ApiDockMethodIndex'
import { LogLevelName } from '../util/Logger'

export interface GemNamespaceMapping {
  namespace: string
  gem: string
}

export type AiProvider = 'ollama' | 'openai' | 'anthropic' | 'vscode-lm'
export type ProjectTypeOverride = 'auto' | 'monolith' | 'api_only' | 'gem' | 'script'
export type RubocopMode = 'safe' | 'unsafe'
export type TestingFramework = 'rspec' | 'minitest'
export type AutoOptimizeWorkspace = 'auto' | 'prompt' | 'disabled'

export const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/vendor/**',
  '**/tmp/**',
  '**/log/**',
  '**/.git/**',
  '**/coverage/**',
  '**/public/assets/**',
  '**/public/packs/**',
]

export interface RailsForgeConfig {
  excludePatterns: string[]
  projectTypeOverride: ProjectTypeOverride
  rubocopAutocorrectOnSave: boolean
  rubocopMode: RubocopMode
  brakemanScanOnSave: boolean
  testingFramework: TestingFramework
  schemaAutoIndex: boolean
  routesAutoIndex: boolean
  ollamaHost: string
  ollamaModel: string
  ollamaEmbeddingModel: string
  ollamaNumCtx: number
  ollamaKeepAlive: string
  ollamaRepeatPenalty: number
  ollamaMinP: number
  aiProvider: AiProvider
  /** Preferred model family when aiProvider is 'vscode-lm' (empty = the user's default model). */
  aiVscodeLmFamily: string
  aiOpenaiModel: string
  aiOpenaiBaseUrl: string
  aiAnthropicModel: string
  aiTemperature: number
  aiMaxTokens: number
  aiTimeoutMs: number
  legalSkillsEnabled: boolean
  mcpEnabled: boolean
  apiDocsEnabled: boolean
  performanceCacheSize: number
  performanceAutoOptimizeWorkspace: AutoOptimizeWorkspace
  apidockEnabled: boolean
  apidockBaseUrl: string
  apidockRequestTimeoutMs: number
  apidockCacheTtlHours: number
  apidockCustomMappings: ApiDockMapping[]
  devdocsBaseUrl: string
  devdocsOpenBesideActiveEditor: boolean
  rubydocEnabled: boolean
  rubydocBaseUrl: string
  rubydocRequestTimeoutMs: number
  rubydocCacheTtlDays: number
  rubydocNamespaceMappings: GemNamespaceMapping[]
  devdocsOfflineEnabled: boolean
  devdocsDataBaseUrl: string
  devdocsFetchTimeoutMs: number
  devdocsRubySlug: string
  devdocsRailsSlug: string
  typesSteepEnabled: boolean
  typesSteepScanOnSave: boolean
  typesRbsSigDir: string
  /** Version manager used to run project tools ('auto' detects from .tool-versions/.ruby-version). */
  /** Allow `rails runner` introspection without asking each time (it executes application code). */
  runtimeIntrospectionEnabled: boolean
  /** Route and inject ruby-agent-skills guidance into AI requests. */
  skillsEnabled: boolean
  skillsMaxPerRequest: number
  skillsExtraPaths: string[]
  analyzersEnabled: string[]
  analyzersFlogThreshold: number
  analyzersPaths: string[]
  rubyVersionManager: 'auto' | 'none' | 'mise' | 'asdf' | 'rbenv' | 'rvm' | 'chruby'
  logLevel: LogLevelName
  logFileEnabled: boolean
}

export function readConfig(scope?: vscode.ConfigurationScope): RailsForgeConfig {
  const cfg = vscode.workspace.getConfiguration('railsForge', scope)

  return {
    excludePatterns: cfg.get<string[]>('excludePatterns', DEFAULT_EXCLUDE_PATTERNS),
    projectTypeOverride: cfg.get<ProjectTypeOverride>('projectType.override', 'auto'),
    rubocopAutocorrectOnSave: cfg.get<boolean>('rubocop.autocorrectOnSave', false),
    rubocopMode: cfg.get<RubocopMode>('rubocop.mode', 'safe'),
    brakemanScanOnSave: cfg.get<boolean>('brakeman.scanOnSave', false),
    testingFramework: cfg.get<TestingFramework>('testing.framework', 'rspec'),
    schemaAutoIndex: cfg.get<boolean>('schema.autoIndex', true),
    routesAutoIndex: cfg.get<boolean>('routes.autoIndex', true),
    ollamaHost: cfg.get<string>('ollama.host', 'http://localhost:11434'),
    ollamaModel: cfg.get<string>('ollama.model', 'qwen2.5-coder:14b'),
    ollamaEmbeddingModel: cfg.get<string>('ollama.embeddingModel', 'nomic-embed-text'),
    ollamaNumCtx: cfg.get<number>('ollama.numCtx', 8192),
    ollamaKeepAlive: cfg.get<string>('ollama.keepAlive', '30m'),
    ollamaRepeatPenalty: cfg.get<number>('ollama.repeatPenalty', 1.15),
    ollamaMinP: cfg.get<number>('ollama.minP', 0.05),
    aiProvider: cfg.get<AiProvider>('ai.provider', 'ollama'),
    aiVscodeLmFamily: cfg.get<string>('ai.vscodeLm.family', ''),
    aiOpenaiModel: cfg.get<string>('ai.openai.model', 'gpt-4o-mini'),
    aiOpenaiBaseUrl: cfg.get<string>('ai.openai.baseUrl', 'https://api.openai.com'),
    aiAnthropicModel: cfg.get<string>('ai.anthropic.model', 'claude-sonnet-4-5'),
    aiTemperature: cfg.get<number>('ai.temperature', 0.2),
    aiMaxTokens: cfg.get<number>('ai.maxTokens', 2048),
    aiTimeoutMs: cfg.get<number>('ai.timeoutMs', 120000),
    legalSkillsEnabled: cfg.get<boolean>('legal.skills.enabled', false),
    mcpEnabled: cfg.get<boolean>('mcp.enabled', true),
    apiDocsEnabled: cfg.get<boolean>('apiDocs.enabled', true),
    performanceCacheSize: cfg.get<number>('performance.cacheSize', 200),
    performanceAutoOptimizeWorkspace: cfg.get<AutoOptimizeWorkspace>('performance.autoOptimizeWorkspace', 'auto'),
    apidockEnabled: cfg.get<boolean>('apidock.enabled', true),
    apidockBaseUrl: cfg.get<string>('apidock.baseUrl', 'https://apidock.com'),
    apidockRequestTimeoutMs: cfg.get<number>('apidock.requestTimeoutMs', 5000),
    apidockCacheTtlHours: cfg.get<number>('apidock.cacheTtlHours', 24),
    apidockCustomMappings: sanitizeApiDockMappings(cfg.get<unknown>('apidock.customMappings', [])),
    devdocsBaseUrl: cfg.get<string>('devdocs.baseUrl', 'https://devdocs.io'),
    devdocsOpenBesideActiveEditor: cfg.get<boolean>('devdocs.openBesideActiveEditor', true),
    rubydocEnabled: cfg.get<boolean>('rubydoc.enabled', true),
    rubydocBaseUrl: cfg.get<string>('rubydoc.baseUrl', 'https://www.rubydoc.info'),
    rubydocRequestTimeoutMs: cfg.get<number>('rubydoc.requestTimeoutMs', 6000),
    rubydocCacheTtlDays: cfg.get<number>('rubydoc.cacheTtlDays', 7),
    rubydocNamespaceMappings: sanitizeGemNamespaceMappings(cfg.get<unknown>('rubydoc.namespaceMappings', [])),
    devdocsOfflineEnabled: cfg.get<boolean>('devdocs.offlineEnabled', true),
    devdocsDataBaseUrl: cfg.get<string>('devdocs.dataBaseUrl', 'https://documents.devdocs.io'),
    devdocsFetchTimeoutMs: cfg.get<number>('devdocs.fetchTimeoutMs', 30000),
    devdocsRubySlug: cfg.get<string>('devdocs.rubySlug', ''),
    devdocsRailsSlug: cfg.get<string>('devdocs.railsSlug', ''),
    typesSteepEnabled: cfg.get<boolean>('types.steepEnabled', false),
    typesSteepScanOnSave: cfg.get<boolean>('types.steepScanOnSave', false),
    typesRbsSigDir: cfg.get<string>('types.rbsSigDir', 'sig'),
    runtimeIntrospectionEnabled: cfg.get<boolean>('runtime.introspection.enabled', false),
    skillsEnabled: cfg.get<boolean>('skills.enabled', true),
    skillsMaxPerRequest: cfg.get<number>('skills.maxPerRequest', 4),
    skillsExtraPaths: cfg.get<string[]>('skills.extraPaths', []),
    analyzersEnabled: cfg.get<string[]>('analyzers.enabled', []),
    analyzersFlogThreshold: cfg.get<number>('analyzers.flogThreshold', 20),
    analyzersPaths: cfg.get<string[]>('analyzers.paths', ['app', 'lib']),
    rubyVersionManager: cfg.get<RailsForgeConfig['rubyVersionManager']>('ruby.versionManager', 'auto'),
    logLevel: cfg.get<LogLevelName>('log.level', 'info'),
    logFileEnabled: cfg.get<boolean>('log.file', false),
  }
}

/** Same defensive-validation rationale as `sanitizeApiDockMappings` — user JSON, dropped if malformed. */
function sanitizeGemNamespaceMappings(raw: unknown): GemNamespaceMapping[] {
  if (!Array.isArray(raw)) {return []}

  const result: GemNamespaceMapping[] = []
  for (const entry of raw) {
    if (
      entry
      && typeof entry === 'object'
      && typeof (entry as Record<string, unknown>).namespace === 'string'
      && typeof (entry as Record<string, unknown>).gem === 'string'
    ) {
      result.push(entry as GemNamespaceMapping)
    }
  }
  return result
}

/**
 * `railsForge.apidock.customMappings` is user-authored JSON, so it's validated
 * defensively rather than trusted — a malformed entry is dropped rather than
 * crashing activation or corrupting ApiDockMethodIndex's lookup map.
 */
function sanitizeApiDockMappings(raw: unknown): ApiDockMapping[] {
  if (!Array.isArray(raw)) {return []}

  const validNamespaces = new Set(['rails', 'ruby', 'rspec'])
  const result: ApiDockMapping[] = []
  for (const entry of raw) {
    if (
      entry
      && typeof entry === 'object'
      && typeof (entry as Record<string, unknown>).keyword === 'string'
      && typeof (entry as Record<string, unknown>).namespace === 'string'
      && validNamespaces.has((entry as Record<string, unknown>).namespace as string)
      && typeof (entry as Record<string, unknown>).className === 'string'
      && typeof (entry as Record<string, unknown>).methodName === 'string'
    ) {
      result.push(entry as ApiDockMapping)
    }
  }
  return result
}

/** Combines exclude glob patterns into the single-string form `vscode.workspace.findFiles` expects. */
export function buildExcludeGlob(patterns: string[]): string | null {
  const trimmed = patterns.map(p => p.trim()).filter(Boolean)
  if (trimmed.length === 0) {return null}
  return trimmed.length === 1 ? trimmed[0] : `{${trimmed.join(',')}}`
}

/** True if `filePath` falls under any of the configured exclude patterns' directory roots. */
export function isExcludedPath(filePath: string, excludePatterns: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return excludePatterns.some(pattern => {
    const dir = pattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, '')
    return dir.length > 0 && normalized.includes(`/${dir}/`)
  })
}

/** Fires whenever any `railsForge.*` setting changes, workspace or user level. */
export function onConfigChanged(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('railsForge')) {
      listener()
    }
  })
}
