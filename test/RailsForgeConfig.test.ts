import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as vscode from 'vscode'
import {
  readConfig,
  buildExcludeGlob,
  isExcludedPath,
  onConfigChanged,
  DEFAULT_EXCLUDE_PATTERNS,
} from '../src/config/RailsForgeConfig'

// --------------------------------------------------------------------------
// buildExcludeGlob
// --------------------------------------------------------------------------
describe('buildExcludeGlob', () => {
  it('returns null for an empty pattern list', () => {
    expect(buildExcludeGlob([])).toBeNull()
  })

  it('returns the single pattern unwrapped when there is only one', () => {
    expect(buildExcludeGlob(['**/node_modules/**'])).toBe('**/node_modules/**')
  })

  it('combines multiple patterns into a brace-group glob', () => {
    expect(buildExcludeGlob(['**/node_modules/**', '**/tmp/**'])).toBe('{**/node_modules/**,**/tmp/**}')
  })

  it('drops blank entries', () => {
    expect(buildExcludeGlob(['**/tmp/**', '  ', ''])).toBe('**/tmp/**')
  })

  it('returns null when all entries are blank', () => {
    expect(buildExcludeGlob(['  ', '', '\t'])).toBeNull()
  })

  it('trims whitespace from patterns', () => {
    expect(buildExcludeGlob(['  **/foo/**  ', '**/bar/**'])).toBe('{**/foo/**,**/bar/**}')
  })
})

// --------------------------------------------------------------------------
// isExcludedPath
// --------------------------------------------------------------------------
describe('isExcludedPath', () => {
  it('matches a file under an excluded directory', () => {
    expect(isExcludedPath('/repo/vendor/bundle/gems/foo.rb', DEFAULT_EXCLUDE_PATTERNS)).toBe(true)
    expect(isExcludedPath('/repo/tmp/cache/foo.rb', DEFAULT_EXCLUDE_PATTERNS)).toBe(true)
  })

  it('does not match a file outside any excluded directory', () => {
    expect(isExcludedPath('/repo/app/models/user.rb', DEFAULT_EXCLUDE_PATTERNS)).toBe(false)
  })

  it('respects custom exclude patterns', () => {
    expect(isExcludedPath('/repo/spec/dummy/db/schema.rb', ['**/spec/dummy/**'])).toBe(true)
    expect(isExcludedPath('/repo/db/schema.rb', ['**/spec/dummy/**'])).toBe(false)
  })

  it('normalizes backslashes to forward slashes', () => {
    expect(isExcludedPath('C:\\Users\\project\\vendor\\gem.rb', ['**/vendor/**'])).toBe(true)
  })

  it('returns false for empty exclude patterns', () => {
    expect(isExcludedPath('/repo/vendor/foo.rb', [])).toBe(false)
  })

  it('returns false for pattern with only glob wildcards (empty dir after stripping)', () => {
    // Pattern '**/**' strips to '' which has length 0, so it is skipped
    expect(isExcludedPath('/repo/app/foo.rb', ['**/**'])).toBe(false)
  })

  it('matches file in a nested excluded path', () => {
    expect(isExcludedPath('/repo/log/production/2024.log', ['**/log/**'])).toBe(true)
    expect(isExcludedPath('/repo/.git/objects/pack/foo', ['**/.git/**'])).toBe(true)
  })
})

// --------------------------------------------------------------------------
// readConfig
// --------------------------------------------------------------------------
describe('readConfig', () => {
  /** Helper: create a fake cfg.get() that returns the given overrides or falls back to defaults. */
  function makeMockGet(overrides: Record<string, unknown> = {}) {
    return (key: string, defaultValue: unknown): unknown => {
      if (key in overrides) { return overrides[key] }
      return defaultValue
    }
  }

  let getConfigSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    getConfigSpy = vi.spyOn(vscode.workspace, 'getConfiguration')
  })

  afterEach(() => {
    getConfigSpy.mockRestore()
  })

  it('returns all default values when no workspace overrides exist', () => {
    getConfigSpy.mockReturnValue({
      get: makeMockGet(),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()

    expect(config.excludePatterns).toEqual(DEFAULT_EXCLUDE_PATTERNS)
    expect(config.projectTypeOverride).toBe('auto')
    expect(config.rubocopAutocorrectOnSave).toBe(false)
    expect(config.rubocopMode).toBe('safe')
    expect(config.brakemanScanOnSave).toBe(false)
    expect(config.testingFramework).toBe('rspec')
    expect(config.schemaAutoIndex).toBe(true)
    expect(config.routesAutoIndex).toBe(true)
    expect(config.ollamaHost).toBe('http://localhost:11434')
    expect(config.ollamaModel).toBe('qwen2.5-coder:14b')
    expect(config.ollamaEmbeddingModel).toBe('nomic-embed-text')
    expect(config.ollamaNumCtx).toBe(8192)
    expect(config.ollamaKeepAlive).toBe('30m')
    expect(config.ollamaRepeatPenalty).toBe(1.15)
    expect(config.ollamaMinP).toBe(0.05)
    expect(config.aiProvider).toBe('ollama')
    expect(config.aiOpenaiModel).toBe('gpt-4o-mini')
    expect(config.aiOpenaiBaseUrl).toBe('https://api.openai.com')
    expect(config.aiAnthropicModel).toBe('claude-sonnet-4-5')
    expect(config.aiTemperature).toBe(0.2)
    expect(config.aiMaxTokens).toBe(2048)
    expect(config.aiTimeoutMs).toBe(120000)
    expect(config.legalSkillsEnabled).toBe(false)
    expect(config.mcpEnabled).toBe(true)
    expect(config.apiDocsEnabled).toBe(true)
    expect(config.performanceCacheSize).toBe(200)
    expect(config.performanceAutoOptimizeWorkspace).toBe('auto')
    expect(config.apidockEnabled).toBe(true)
    expect(config.apidockBaseUrl).toBe('https://apidock.com')
    expect(config.apidockRequestTimeoutMs).toBe(5000)
    expect(config.apidockCacheTtlHours).toBe(24)
    expect(config.apidockCustomMappings).toEqual([])
    expect(config.devdocsBaseUrl).toBe('https://devdocs.io')
    expect(config.devdocsOpenBesideActiveEditor).toBe(true)
    expect(config.rubydocEnabled).toBe(true)
    expect(config.rubydocBaseUrl).toBe('https://www.rubydoc.info')
    expect(config.rubydocRequestTimeoutMs).toBe(6000)
    expect(config.rubydocCacheTtlDays).toBe(7)
    expect(config.rubydocNamespaceMappings).toEqual([])
    expect(config.devdocsOfflineEnabled).toBe(true)
    expect(config.devdocsDataBaseUrl).toBe('https://documents.devdocs.io')
    expect(config.devdocsFetchTimeoutMs).toBe(30000)
    expect(config.devdocsRubySlug).toBe('')
    expect(config.devdocsRailsSlug).toBe('')
    expect(config.typesSteepEnabled).toBe(false)
    expect(config.typesSteepScanOnSave).toBe(false)
    expect(config.typesRbsSigDir).toBe('sig')
    expect(config.logLevel).toBe('info')
    expect(config.logFileEnabled).toBe(false)
  })

  it('reads workspace-overridden values', () => {
    getConfigSpy.mockReturnValue({
      get: makeMockGet({
        'projectType.override': 'api_only' as const,
        'rubocop.autocorrectOnSave': true,
        'rubocop.mode': 'unsafe' as const,
        'brakeman.scanOnSave': true,
        'testing.framework': 'minitest' as const,
        'schema.autoIndex': false,
        'routes.autoIndex': false,
      }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()

    expect(config.projectTypeOverride).toBe('api_only')
    expect(config.rubocopAutocorrectOnSave).toBe(true)
    expect(config.rubocopMode).toBe('unsafe')
    expect(config.brakemanScanOnSave).toBe(true)
    expect(config.testingFramework).toBe('minitest')
    expect(config.schemaAutoIndex).toBe(false)
    expect(config.routesAutoIndex).toBe(false)
  })

  it('reads AI provider overrides', () => {
    getConfigSpy.mockReturnValue({
      get: makeMockGet({
        'ai.provider': 'openai' as const,
        'ollama.host': 'http://custom:11434',
        'ai.openai.model': 'gpt-4o',
        'ai.openai.baseUrl': 'https://my-proxy.com',
        'ai.temperature': 0.7,
        'ai.maxTokens': 4096,
        'ai.timeoutMs': 60000,
      }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()

    expect(config.aiProvider).toBe('openai')
    expect(config.ollamaHost).toBe('http://custom:11434')
    expect(config.aiOpenaiModel).toBe('gpt-4o')
    expect(config.aiOpenaiBaseUrl).toBe('https://my-proxy.com')
    expect(config.aiTemperature).toBe(0.7)
    expect(config.aiMaxTokens).toBe(4096)
    expect(config.aiTimeoutMs).toBe(60000)
  })

  it('reads anthropic provider overrides', () => {
    getConfigSpy.mockReturnValue({
      get: makeMockGet({
        'ai.provider': 'anthropic' as const,
        'ai.anthropic.model': 'claude-3-opus',
      }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()

    expect(config.aiProvider).toBe('anthropic')
    expect(config.aiAnthropicModel).toBe('claude-3-opus')
  })

  it('reads ollama-specific overrides', () => {
    getConfigSpy.mockReturnValue({
      get: makeMockGet({
        'ollama.model': 'llama3:70b',
        'ollama.embeddingModel': 'mxbai-embed-large',
        'ollama.numCtx': 16384,
        'ollama.keepAlive': '60m',
        'ollama.repeatPenalty': 1.2,
        'ollama.minP': 0.1,
      }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()

    expect(config.ollamaModel).toBe('llama3:70b')
    expect(config.ollamaEmbeddingModel).toBe('mxbai-embed-large')
    expect(config.ollamaNumCtx).toBe(16384)
    expect(config.ollamaKeepAlive).toBe('60m')
    expect(config.ollamaRepeatPenalty).toBe(1.2)
    expect(config.ollamaMinP).toBe(0.1)
  })

  it('reads devdocs overrides', () => {
    getConfigSpy.mockReturnValue({
      get: makeMockGet({
        'devdocs.baseUrl': 'https://custom.devdocs.io',
        'devdocs.openBesideActiveEditor': false,
        'devdocs.offlineEnabled': false,
        'devdocs.dataBaseUrl': 'https://my-mirror.devdocs.io',
        'devdocs.fetchTimeoutMs': 10000,
        'devdocs.rubySlug': 'ruby',
        'devdocs.railsSlug': 'rails',
      }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()

    expect(config.devdocsBaseUrl).toBe('https://custom.devdocs.io')
    expect(config.devdocsOpenBesideActiveEditor).toBe(false)
    expect(config.devdocsOfflineEnabled).toBe(false)
    expect(config.devdocsDataBaseUrl).toBe('https://my-mirror.devdocs.io')
    expect(config.devdocsFetchTimeoutMs).toBe(10000)
    expect(config.devdocsRubySlug).toBe('ruby')
    expect(config.devdocsRailsSlug).toBe('rails')
  })

  it('reads rubydoc overrides', () => {
    getConfigSpy.mockReturnValue({
      get: makeMockGet({
        'rubydoc.enabled': false,
        'rubydoc.baseUrl': 'https://custom.rubydoc.org',
        'rubydoc.requestTimeoutMs': 10000,
        'rubydoc.cacheTtlDays': 14,
      }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()

    expect(config.rubydocEnabled).toBe(false)
    expect(config.rubydocBaseUrl).toBe('https://custom.rubydoc.org')
    expect(config.rubydocRequestTimeoutMs).toBe(10000)
    expect(config.rubydocCacheTtlDays).toBe(14)
  })

  it('reads types/steep overrides', () => {
    getConfigSpy.mockReturnValue({
      get: makeMockGet({
        'types.steepEnabled': true,
        'types.steepScanOnSave': true,
        'types.rbsSigDir': 'sig/custom',
      }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()

    expect(config.typesSteepEnabled).toBe(true)
    expect(config.typesSteepScanOnSave).toBe(true)
    expect(config.typesRbsSigDir).toBe('sig/custom')
  })

  it('reads logging overrides', () => {
    getConfigSpy.mockReturnValue({
      get: makeMockGet({
        'log.level': 'debug' as const,
        'log.file': true,
      }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()

    expect(config.logLevel).toBe('debug')
    expect(config.logFileEnabled).toBe(true)
  })

  it('reads performance overrides', () => {
    getConfigSpy.mockReturnValue({
      get: makeMockGet({
        'performance.cacheSize': 500,
        'performance.autoOptimizeWorkspace': 'prompt' as const,
      }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()

    expect(config.performanceCacheSize).toBe(500)
    expect(config.performanceAutoOptimizeWorkspace).toBe('prompt')
  })

  it('reads other boolean/string overrides', () => {
    getConfigSpy.mockReturnValue({
      get: makeMockGet({
        'legal.skills.enabled': true,
        'mcp.enabled': false,
        'apiDocs.enabled': false,
      }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()

    expect(config.legalSkillsEnabled).toBe(true)
    expect(config.mcpEnabled).toBe(false)
    expect(config.apiDocsEnabled).toBe(false)
  })

  it('reads apidock overrides', () => {
    getConfigSpy.mockReturnValue({
      get: makeMockGet({
        'apidock.enabled': false,
        'apidock.baseUrl': 'https://custom.apidock.com',
        'apidock.requestTimeoutMs': 10000,
        'apidock.cacheTtlHours': 48,
      }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()

    expect(config.apidockEnabled).toBe(false)
    expect(config.apidockBaseUrl).toBe('https://custom.apidock.com')
    expect(config.apidockRequestTimeoutMs).toBe(10000)
    expect(config.apidockCacheTtlHours).toBe(48)
  })

  it('passes scope to getConfiguration', () => {
    const scope = { uri: { fsPath: '/my/folder' } }
    getConfigSpy.mockReturnValue({
      get: makeMockGet(),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    readConfig(scope as unknown as vscode.ConfigurationScope)

    expect(getConfigSpy).toHaveBeenCalledWith('railsForge', scope)
  })

  it('sanitizes valid apidock custom mappings', () => {
    const validMappings = [
      { keyword: 'find_by', namespace: 'rails', className: 'ActiveRecord/Base', methodName: 'find_by' },
      { keyword: 'require', namespace: 'ruby', className: 'Kernel', methodName: 'require' },
      { keyword: 'describe', namespace: 'rspec', className: 'RSpec/Core/ExampleGroup', methodName: 'describe' },
    ]
    getConfigSpy.mockReturnValue({
      get: makeMockGet({ 'apidock.customMappings': validMappings }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()
    expect(config.apidockCustomMappings).toEqual(validMappings)
  })

  it('filters out apidock custom mappings with invalid namespace', () => {
    const mixedMappings = [
      { keyword: 'good', namespace: 'rails', className: 'Foo/Bar', methodName: 'baz' },
      { keyword: 'bad', namespace: 'invalid_ns', className: 'Foo/Bar', methodName: 'baz' },
    ]
    getConfigSpy.mockReturnValue({
      get: makeMockGet({ 'apidock.customMappings': mixedMappings }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()
    expect(config.apidockCustomMappings).toEqual([
      { keyword: 'good', namespace: 'rails', className: 'Foo/Bar', methodName: 'baz' },
    ])
  })

  it('filters out apidock custom mappings missing required string fields', () => {
    const badMappings = [
      { keyword: 123, namespace: 'rails', className: 'Foo', methodName: 'bar' },       // keyword not a string
      { keyword: 'kw', namespace: 'rails', className: null, methodName: 'bar' },       // className not a string
      { keyword: 'kw', namespace: 'rails' },                                           // missing className & methodName
      { keyword: 'kw', namespace: 'rails', className: 'C', methodName: 42 },           // methodName not a string
      'just-a-string',                                                                  // not an object
      null,                                                                              // null entry
      undefined,                                                                         // undefined entry
      { keyword: 'kw', namespace: 999, className: 'C', methodName: 'm' },              // namespace not a string
    ]
    getConfigSpy.mockReturnValue({
      get: makeMockGet({ 'apidock.customMappings': badMappings }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()
    expect(config.apidockCustomMappings).toEqual([])
  })

  it('returns empty array for non-array apidock custom mappings', () => {
    getConfigSpy.mockReturnValue({
      get: makeMockGet({ 'apidock.customMappings': 'not-an-array' }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()
    expect(config.apidockCustomMappings).toEqual([])
  })

  it('sanitizes valid rubydoc namespace mappings', () => {
    const validMappings = [
      { namespace: 'ActiveSupport', gem: 'activesupport' },
      { namespace: 'ActiveRecord', gem: 'activerecord' },
    ]
    getConfigSpy.mockReturnValue({
      get: makeMockGet({ 'rubydoc.namespaceMappings': validMappings }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()
    expect(config.rubydocNamespaceMappings).toEqual(validMappings)
  })

  it('filters out rubydoc namespace mappings missing required string fields', () => {
    const badMappings = [
      { namespace: 'Foo', gem: 42 },          // gem not a string
      { namespace: 123, gem: 'bar' },          // namespace not a string
      { namespace: 'Foo' },                    // missing gem
      null,                                     // null entry
      'string-entry',                           // not an object
      undefined,                                // undefined entry
      {},                                       // empty object
    ]
    getConfigSpy.mockReturnValue({
      get: makeMockGet({ 'rubydoc.namespaceMappings': badMappings }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()
    expect(config.rubydocNamespaceMappings).toEqual([])
  })

  it('returns empty array for non-array rubydoc namespace mappings', () => {
    getConfigSpy.mockReturnValue({
      get: makeMockGet({ 'rubydoc.namespaceMappings': { namespace: 'X', gem: 'Y' } }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()
    expect(config.rubydocNamespaceMappings).toEqual([])
  })

  it('reads custom excludePatterns override', () => {
    const customPatterns = ['**/spec/dummy/**', '**/pkg/**']
    getConfigSpy.mockReturnValue({
      get: makeMockGet({ excludePatterns: customPatterns }),
      update: vi.fn(),
    } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>)

    const config = readConfig()
    expect(config.excludePatterns).toEqual(customPatterns)
  })
})

// --------------------------------------------------------------------------
// onConfigChanged
// --------------------------------------------------------------------------
describe('onConfigChanged', () => {
  it('calls listener when railsForge configuration changes', () => {
    let registeredHandler: ((e: { affectsConfiguration: (section: string) => boolean }) => void) | null = null
    const disposable = { dispose: vi.fn() }

    // Temporarily add onDidChangeConfiguration to the workspace mock
    const originalOnDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration
    ;(vscode.workspace as Record<string, unknown>).onDidChangeConfiguration = vi.fn(
      (handler: (e: { affectsConfiguration: (section: string) => boolean }) => void) => {
        registeredHandler = handler
        return disposable
      },
    )

    const listener = vi.fn()
    onConfigChanged(listener)

    // Simulate a railsForge config change
    expect(registeredHandler).not.toBeNull()
    registeredHandler!({ affectsConfiguration: (section: string) => section === 'railsForge' })
    expect(listener).toHaveBeenCalledOnce()

    // Restore
    ;(vscode.workspace as Record<string, unknown>).onDidChangeConfiguration = originalOnDidChangeConfiguration
  })

  it('does NOT call listener for non-railsForge config changes', () => {
    let registeredHandler: ((e: { affectsConfiguration: (section: string) => boolean }) => void) | null = null
    const disposable = { dispose: vi.fn() }

    const originalOnDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration
    ;(vscode.workspace as Record<string, unknown>).onDidChangeConfiguration = vi.fn(
      (handler: (e: { affectsConfiguration: (section: string) => boolean }) => void) => {
        registeredHandler = handler
        return disposable
      },
    )

    const listener = vi.fn()
    onConfigChanged(listener)

    registeredHandler!({ affectsConfiguration: (section: string) => section === 'editor' })
    expect(listener).not.toHaveBeenCalled()

    ;(vscode.workspace as Record<string, unknown>).onDidChangeConfiguration = originalOnDidChangeConfiguration
  })

  it('returns a disposable from onDidChangeConfiguration', () => {
    const disposable = { dispose: vi.fn() }

    const originalOnDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration
    ;(vscode.workspace as Record<string, unknown>).onDidChangeConfiguration = vi.fn(() => disposable)

    const result = onConfigChanged(vi.fn())
    expect(result).toBe(disposable)

    ;(vscode.workspace as Record<string, unknown>).onDidChangeConfiguration = originalOnDidChangeConfiguration
  })
})
