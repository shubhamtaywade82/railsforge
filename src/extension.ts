/**
 * RailsForge Extension Entry Point
 */

import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'

import { SchemaIndexer } from './rails/SchemaIndexer'
import { RoutesIndexer } from './rails/RoutesIndexer'
import { RouteHelperCompletionProvider } from './rails/RouteHelperCompletionProvider'
import { MVCNavigator } from './rails/MVCNavigator'
import { SchemaHoverProvider } from './rails/SchemaHoverProvider'
import { RuboCopProvider } from './lint/RuboCopProvider'
import { BrakemanProvider } from './lint/BrakemanProvider'
import { ServiceExtractor } from './refactor/ServiceExtractor'
import { QueryExtractor } from './refactor/QueryExtractor'
import { BundlerAuditScanner } from './lint/BundlerAuditScanner'
import { StrongMigrationsAnalyzer } from './rails/StrongMigrationsAnalyzer'
import { PolicyNavigator } from './rails/PolicyNavigator'
import { ViewComponentResolver } from './rails/ViewComponentResolver'
import { MigrationDiagnostics } from './rails/MigrationDiagnostics'
import { StimulusIndexer } from './hotwire/StimulusIndexer'
import { StimulusCompletionProvider } from './hotwire/StimulusCompletionProvider'
import { StimulusDefinitionProvider } from './hotwire/StimulusDefinitionProvider'
import { TurboFrameNavigator } from './hotwire/TurboFrameNavigator'
import { TurboFrameDefinitionProvider } from './hotwire/TurboFrameDefinitionProvider'
import { ViewPartialResolver } from './rails/ViewPartialResolver'
import { ViewPartialDefinitionProvider } from './rails/ViewPartialDefinitionProvider'
import { TestExplorerController, debugRubyCommand } from './testing/TestExplorerController'
import { TestCodeLensProvider } from './testing/TestCodeLensProvider'
import { activeWorkspaceRoot, workspaceRoots, workspaceRootFor } from './workspace/activeRoot'
import { isInside, resolveWorkspaceRoot } from './workspace/WorkspaceRoots'
import { RubyAnalyzersProvider, AnalyzerRunResult } from './lint/RubyAnalyzersProvider'
import { ANALYZER_IDS, AnalyzerId } from './lint/AnalyzerParsers'
import { LmApiLike, registerRailsLanguageModelTools } from './ai/RailsLanguageModelTools'
import { ToolContext } from './mcp/tools/ToolContext'
import { buildSemanticContext, selectSeeds } from './semantic/RailsContextBuilder'
import { routeSkills } from './skills/SkillRouter'
import { buildSkillContext } from './skills/SkillContextBuilder'
import { ProjectState } from './util/ProjectState'
import { VIRTUAL_DOC_KINDS, VIRTUAL_DOC_SCHEME, VirtualDocKind } from './views/VirtualDocs'
import { VirtualDocsProvider, patternDocUri, virtualDocUri } from './views/VirtualDocsProvider'
import { showRuntimeSnapshot } from './rails/RuntimeIntrospectionService'
import { RAILSFORGE_TASK_TYPE, RailsTaskProvider } from './tasks/RailsTaskProvider'
import { GENERATORS, GeneratorMode, buildGeneratorArgs, parseAttributes, parseGeneratorOutput, validateGeneratorName } from './rails/RailsGenerators'
import { firstCandidate, projectVersionManager, setVersionManagerSettingProvider, rubyCandidates, rubyTerminalCommand } from './util/RubyCommand'
import { ShellKind, shellKindFromPath, hasPathSegment } from './util/ShellCommand'
import { patchFileMatches } from './patch/PatchPaths'
import { EnvironmentDetector, ProjectEnvironment, isKnownVersion } from './environment/EnvironmentDetector'
import { RailsDeprecationLinter } from './lint/RailsDeprecationLinter'
import { DesignPrincipleLinter } from './principles/DesignPrincipleLinter'
import { VersionDocsEngine } from './docs/VersionDocsEngine'
import { FactoryBotResolver } from './testing/FactoryBotResolver'
import { RailsArchitectureTreeProvider } from './views/RailsArchitectureTreeProvider'
import { PatternCatalogTreeProvider, PatternItem } from './views/PatternCatalogTreeProvider'
import { explainPatternPrompt, getCatalogPattern, toProjectInstances } from './patterns/PatternCatalog'
import { PatternDiagnosticsProvider } from './patterns/PatternDiagnosticsProvider'
import { ProjectPatternIndexer } from './patterns/ProjectPatternIndexer'
import { PatternCodeLensProvider } from './patterns/PatternCodeLensProvider'
import { MinimalDependencyGraph } from './graph/MinimalDependencyGraph'
import { DependencyDiagnosticsProvider } from './graph/DependencyDiagnosticsProvider'
import { RelatedFilesIndex } from './graph/RelatedFilesIndex'
import { RelatedCodeLensProvider } from './graph/RelatedCodeLensProvider'
import { RelatedHoverProvider } from './graph/RelatedHoverProvider'
import { FormObjectExtractor } from './refactor/FormObjectExtractor'
import { ValueObjectExtractor } from './refactor/ValueObjectExtractor'
import { RefactoringMenuProvider } from './refactor/RefactoringMenuProvider'
import { RailsAgent, AiFixProposal, RailsAgentConfig } from './agent/RailsAgent'
import { applyUnifiedHunks, parseUnifiedDiff } from './patch/UnifiedDiff'
import { RailsChatParticipant } from './chat/RailsChatParticipant'
import { RailsChatViewProvider } from './chat/RailsChatViewProvider'
import { smartApplyResponse } from './chat/ChatDiffApplier'
import { PersistentIndexManager } from './indexer/PersistentIndexManager'
import { PerRootRegistry } from './workspace/PerRootRegistry'
import { DevDocsProject } from './docs/DevDocsProject'
import { PersistentIndexRegistry, IndexState } from './indexer/PersistentIndexRegistry'
import { findDuplicateCallSites } from './refactor/DuplicateCallSiteFinder'
import { specFilePathFor, buildRspecSkeleton } from './refactor/SpecFileGenerator'
import { buildCursorRulesContent, buildSystemPromptMarkdown } from './mcp/CursorRulesGenerator'
import { EmbeddingClient } from './search/EmbeddingClient'
import { SemanticSearchIndex } from './search/SemanticSearchIndex'
import { EndwiseProvider } from './editing/EndwiseProvider'
import { ErbTagCompletionProvider } from './editing/ErbTagCompletionProvider'
import { GemLensProvider } from './gems/GemLensProvider'
import { RubyGemsClient } from './gems/RubyGemsClient'
import { readConfig, buildExcludeGlob, isExcludedPath, onConfigChanged, RailsForgeConfig, AiProvider } from './config/RailsForgeConfig'
import { buildOpenApiSkeleton } from './docs/OpenApiSkeletonGenerator'
import { ApiDockClient } from './docs/ApiDockClient'
import { ApiDockMethodIndex } from './docs/ApiDockMethodIndex'
import { ApiDockHoverProvider } from './docs/ApiDockHoverProvider'
import { DevDocsPanel } from './docs/DevDocsPanel'
import { RubyDocProvider, RubyDocEntry } from './docs/RubyDocProvider'
import { GemSymbolResolver } from './docs/GemSymbolResolver'
import { parseGemfileLock } from './gems/GemfileLockParser'
import { DevDocsFetcher, toDevDocsSlug } from './docs/DevDocsFetcher'
import { DevDocsOfflineIndex } from './docs/DevDocsOfflineIndex'
import { DevDocsHoverProvider } from './docs/DevDocsHoverProvider'
import { RakeTaskIndexer } from './rake/RakeTaskIndexer'
import { RakeTaskTreeProvider } from './rake/RakeTaskTreeProvider'
import { RuboCopStyleGuideId, getStyleGuideApplication, ensureGemInGemfile, applyInheritGemBlock, applyAirbnbInheritFrom } from './lint/RuboCopStyleGuides'
import { RBSIndex } from './types/RBSIndex'
import { RBSHoverProvider } from './types/RBSHoverProvider'
import { RBSDefinitionProvider } from './types/RBSDefinitionProvider'
import { SteepProvider } from './types/SteepProvider'
import { LearningResource } from './principles/LearningResources'
import { loadEffectiveServiceObjectGuidelines } from './config/EffectiveGuidelines'
import { parseVersion, bumpVersion, replaceVersionInContent, VersionBumpPart } from './gems/GemVersionBumper'
import { SpeculativeFixCache } from './agent/SpeculativeFixCache'
import { Logger } from './util/Logger'
import { handleWorkspaceAutoOptimization, optimizeRailsWorkspace } from './workspace/WorkspaceOptimizer'
import {
  ProviderRegistry,
  PrincipleCodeActionProvider,
  SemanticIndexAdapter,
  PatternCatalogAccessAdapter,
  RefactoringEditProvider,
} from './providers'

const execFileAsync = promisify(execFile)

/** Applies railsForge.log.level and railsForge.log.file immediately, without a reload. */
function applyLogSettings(config: RailsForgeConfig, workspaceRoot: string): void {
  Logger.setLevel(config.logLevel)
  Logger.setLogFile(config.logFileEnabled && workspaceRoot ? path.join(workspaceRoot, '.railsforge', 'railsforge.log') : undefined)
}

/** Read-only state exposed to the Extension Host integration tests (`extension.exports`). */
export interface RailsForgeTestApi {
  getActiveProjectRoot(): string
  getSchemaTableNames(): string[]
  /** AST index status keyed by workspace root (only roots that were activated). */
  getAstIndexStatuses(): Record<string, string>
  /** Number of RBS signatures for `methodName` in the project that owns `filePath`. */
  countRbsMethods(filePath: string, methodName: string): number
  /** DevDocs cache directory of the project that owns `filePath`. */
  getDevDocsCacheDir(filePath: string): string
  /** Discovers tests workspace-wide and returns the Test Explorer tree as indented labels. */
  discoverTestTree(): Promise<string[]>
}

export function activate(context: vscode.ExtensionContext): RailsForgeTestApi {
  projectState = new ProjectState(context.workspaceState)
  skillsPackDir = path.join(context.extensionPath, 'dist', 'skills')
  setVersionManagerSettingProvider(() => readConfig().rubyVersionManager)
  Logger.init(context)
  const config = readConfig()
  Logger.setLevel(config.logLevel)
  const schemaIndexer = new SchemaIndexer()
  const routesIndexer = new RoutesIndexer()
  const mvcNavigator = new MVCNavigator()
  const rubocopProvider = new RuboCopProvider()
  const brakemanProvider = new BrakemanProvider()
  const bundlerAuditScanner = new BundlerAuditScanner()
  const strongMigrationsAnalyzer = new StrongMigrationsAnalyzer()
  const migrationDiagnostics = new MigrationDiagnostics()
  const deprecationLinter = new RailsDeprecationLinter()
  const principleLinter = new DesignPrincipleLinter()
  const patternDiagnostics = new PatternDiagnosticsProvider()
  const projectPatternIndexer = new ProjectPatternIndexer()
  const patternCodeLensProvider = new PatternCodeLensProvider(projectPatternIndexer)
  const dependencyGraph = new MinimalDependencyGraph(projectPatternIndexer, async (filePath: string) => {
    try { return await fs.promises.readFile(filePath, 'utf8') } catch { return '' }
  })
  const dependencyDiagnostics = new DependencyDiagnosticsProvider(dependencyGraph, projectPatternIndexer)
  const relatedFilesIndex = new RelatedFilesIndex(projectPatternIndexer, async (filePath: string) => {
    try { return await fs.promises.readFile(filePath, 'utf8') } catch { return '' }
  })
  const relatedCodeLensProvider = new RelatedCodeLensProvider(relatedFilesIndex, dependencyGraph, projectPatternIndexer)
  const relatedHoverProvider = new RelatedHoverProvider(relatedFilesIndex, dependencyGraph, projectPatternIndexer)
  const docsEngine = new VersionDocsEngine()
  const factoryBotResolver = new FactoryBotResolver()
  const policyNavigator = new PolicyNavigator()
  const viewComponentResolver = new ViewComponentResolver()
  const stimulusIndexer = new StimulusIndexer()
  const turboFrameNavigator = new TurboFrameNavigator()
  const viewPartialResolver = new ViewPartialResolver()
  const rubyGemsClient = new RubyGemsClient(config.performanceCacheSize)
  const apiDockClient = new ApiDockClient({
    cacheSize: config.performanceCacheSize,
    cacheTtlMs: config.apidockCacheTtlHours * 60 * 60 * 1000,
    timeoutMs: config.apidockRequestTimeoutMs,
    baseUrl: config.apidockBaseUrl,
  })
  const apiDockMethodIndex = new ApiDockMethodIndex(config.apidockCustomMappings)
  const rubyDocProvider = new RubyDocProvider({
    cacheSize: config.performanceCacheSize,
    cacheTtlMs: config.rubydocCacheTtlDays * 24 * 60 * 60 * 1000,
    timeoutMs: config.rubydocRequestTimeoutMs,
    baseUrl: config.rubydocBaseUrl,
  })
  const analyzers = new RubyAnalyzersProvider()
  context.subscriptions.push(analyzers)
  const testExplorer = new TestExplorerController()
  context.subscriptions.push(testExplorer)
  const serviceExtractor = new ServiceExtractor()
  const queryExtractor = new QueryExtractor()
  const formExtractor = new FormObjectExtractor()
  const valueExtractor = new ValueObjectExtractor()
  const refactoringMenu = new RefactoringMenuProvider(
    serviceExtractor,
    queryExtractor,
    formExtractor,
    valueExtractor,
    projectPatternIndexer,
  )
  const envDetector = new EnvironmentDetector()

  const workspaceRoot = activeWorkspaceRoot() ?? ''
  // Root the shared (root-bound) indexers currently reflect; swapped by switchActiveProject().
  const activeProject = { root: workspaceRoot }
  const env: ProjectEnvironment = envDetector.detectEnvironment(workspaceRoot)
  if (config.projectTypeOverride !== 'auto') {
    env.projectType = config.projectTypeOverride
  }

  applyLogSettings(config, workspaceRoot)

  // Offline DevDocs + RBS signatures are per project: each workspace root has its own
  // cache directory / sig index, keyed by root, created lazily and dropped with its folder.
  const devDocsProjects = new PerRootRegistry<DevDocsProject>(root => new DevDocsProject(root, {
    createFetcher: cacheDir => new DevDocsFetcher({
      cacheDir,
      timeoutMs: readConfig().devdocsFetchTimeoutMs,
      baseUrl: readConfig().devdocsDataBaseUrl,
    }),
    slugsFor: projectRoot => {
      const cfg = readConfig()
      const projectEnv = projectRoot === activeProject.root ? env : envDetector.detectEnvironment(projectRoot)
      const slugs = [cfg.devdocsRubySlug || (isKnownVersion(projectEnv.rubyVersion) ? toDevDocsSlug('ruby', projectEnv.rubyVersion) : 'ruby')]
      if (projectEnv.hasRails) {
        slugs.push(cfg.devdocsRailsSlug || (isKnownVersion(projectEnv.railsVersion) ? toDevDocsSlug('rails', projectEnv.railsVersion) : 'rails'))
      }
      return slugs
    },
  }))
  const devDocsIndexFor = (uri: vscode.Uri): DevDocsOfflineIndex =>
    devDocsProjects.get(workspaceRootFor(uri) ?? activeProject.root).index
  // Parsed on first use of a root (RBS sig dirs are small), so a hover in any root is correct.
  const rbsIndexes = new PerRootRegistry<RBSIndex>(root => {
    const index = new RBSIndex()
    index.loadFromWorkspace(root, readConfig().typesRbsSigDir)
    return index
  })
  const rbsIndexFor = (uri: vscode.Uri): RBSIndex => rbsIndexes.get(workspaceRootFor(uri) ?? activeProject.root)
  if (workspaceRoot) {
    // Deferred: RBS sig directory walk uses sync I/O; yield to event loop first.
    setTimeout(() => rbsIndexes.get(workspaceRoot), 800)
  }
  const steepProvider = new SteepProvider()
  const steepDiagnostics = vscode.languages.createDiagnosticCollection('steep')
  context.subscriptions.push(steepDiagnostics)

  // Set UI `when`-clause contexts (see package.json's menus.commandPalette and
  // keybindings) so the Command Palette and keybindings only surface commands that
  // are actually relevant to this project — e.g. "Go to View" for a gem with no
  // app/views directory would otherwise always be there but always fail.
  void vscode.commands.executeCommand('setContext', 'railsforge.projectType', env.projectType)
  void vscode.commands.executeCommand('setContext', 'railsforge.isRailsApp', env.projectType === 'monolith' || env.projectType === 'api_only')
  void vscode.commands.executeCommand('setContext', 'railsforge.hasViews', env.projectType === 'monolith')
  void vscode.commands.executeCommand('setContext', 'railsforge.hasHotwire', env.hasHotwire)
  void vscode.commands.executeCommand('setContext', 'railsforge.hasPundit', env.hasPundit)
  void vscode.commands.executeCommand('setContext', 'railsforge.hasViewComponent', env.hasViewComponent)
  void vscode.commands.executeCommand('setContext', 'railsforge.aiProvider', config.aiProvider)
  void vscode.commands.executeCommand('setContext', 'railsforge.apiDocsEnabled', config.apiDocsEnabled)
  void vscode.commands.executeCommand('setContext', 'railsforge.typesSteepEnabled', config.typesSteepEnabled)

  Logger.info(`RailsForge activated. Project type: ${env.projectType}, Ruby: ${env.rubyVersion}, Rails: ${env.hasRails ? env.railsVersion : 'none'}`)

  const getAgentConfig = (cfg: RailsForgeConfig = readConfig()): RailsAgentConfig => ({
    ollamaHost: cfg.ollamaHost,
    model: cfg.ollamaModel,
    provider: cfg.aiProvider,
    openaiModel: cfg.aiOpenaiModel,
    openaiBaseUrl: cfg.aiOpenaiBaseUrl,
    anthropicModel: cfg.aiAnthropicModel,
    temperature: cfg.aiTemperature,
    maxTokens: cfg.aiMaxTokens,
    timeoutMs: cfg.aiTimeoutMs,
    legalMode: cfg.legalSkillsEnabled,
    ollamaNumCtx: cfg.ollamaNumCtx,
    ollamaKeepAlive: cfg.ollamaKeepAlive,
    ollamaRepeatPenalty: cfg.ollamaRepeatPenalty,
    ollamaMinP: cfg.ollamaMinP,
    getApiKey: async () => context.secrets.get(aiApiKeySecretKey(readConfig().aiProvider)),
    vscodeLmFamily: cfg.aiVscodeLmFamily,
    skillContext: ({ prompt, command, fileName, workspaceRoot: root, diagnosticMessage }) => {
      const settings = readConfig()
      if (!settings.skillsEnabled) {return ''}
      const projectRoot = root ?? (fileName ? workspaceRootFor(vscode.Uri.file(fileName)) : undefined)
      if (!projectRoot) {return ''}
      const toolContext = semanticContexts.get(projectRoot)
      const registry = toolContext.getSkillRegistry()
      if (!registry.catalog) {return ''}
      const kinds = [...new Set(selectSeeds(toolContext.getSemanticGraph(), { prompt: `${prompt}\n${diagnosticMessage ?? ''}`, filePath: fileName, maxSeeds: 8 }).map(e => e.kind))]
      const input = { prompt, command, entityKinds: kinds, context: diagnosticMessage }
      const routed = routeSkills(registry.catalog, input, { maxSkills: settings.skillsMaxPerRequest })
      Logger.debug(`[skills] ${routed.map(r => `${r.id}(${r.role})`).join(', ') || 'none'}`)
      return buildSkillContext(registry, routed, input, { maxChars: 5000 })
    },
    semanticContext: ({ prompt, fileName, workspaceRoot: root }) => {
      const projectRoot = root ?? (fileName ? workspaceRootFor(vscode.Uri.file(fileName)) : undefined)
      if (!projectRoot) {return ''}
      return buildSemanticContext(semanticContexts.get(projectRoot).getSemanticGraph(), { filePath: fileName, prompt, maxChars: 3500 })
    },
    vscodeLmRequest: (system, prompt) => requestViaVsCodeLm(system, prompt, readConfig().aiVscodeLmFamily, readConfig().aiTimeoutMs),
    vscodeLmStatus: () => vscodeLmStatus(readConfig().aiVscodeLmFamily),
    log: (level: 'debug' | 'trace' | 'warn', message: string) => {
      if (level === 'debug') { Logger.debug(message) }
      else if (level === 'trace') { Logger.trace(message) }
      else { Logger.warn(message) }
    },
  })

  const agent = new RailsAgent(
    schemaIndexer,
    routesIndexer,
    getAgentConfig(config),
    env,
    projectPatternIndexer,
  )

  context.subscriptions.push(onConfigChanged(() => {
    const freshConfig = readConfig()
    applyLogSettings(freshConfig, workspaceRoot)
    agent.updateConfig(getAgentConfig(freshConfig))
    void vscode.commands.executeCommand('setContext', 'railsforge.aiProvider', freshConfig.aiProvider)
  }))

  const embeddingClient = new EmbeddingClient({
    ollamaHost: config.ollamaHost,
    model: config.ollamaEmbeddingModel,
  })
  const semanticSearchIndex = new SemanticSearchIndex(projectPatternIndexer, text => embeddingClient.embed(text), config.performanceCacheSize)

  // Speculative Fix Cache - pre-generates fixes for common RuboCop offenses
  // so they're instant when the user requests a fix.
  const speculativeFixCache = new SpeculativeFixCache(agent)
  if (workspaceRoot && context.extensionMode !== vscode.ExtensionMode.Test) {
    // Deferred: AI cache warm is CPU/network-heavy, not needed until first fix request.
    setTimeout(() => void speculativeFixCache.warm(), 8000)
  }

  // 1. Sidebar Chat Webview Provider (Same architecture as PineForge)
  const chatViewProvider = new RailsChatViewProvider(
    context.extensionUri,
    agent,
    schemaIndexer,
    routesIndexer,
    () => projectPatternIndexer.getAllPatterns().map(p => `${p.type}/${p.name}`),
  )
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('railsforge.chatView', chatViewProvider),
  )

  // Phase 12: persistent AST/SQLite index (tree-sitter + better-sqlite3, off-thread).
  // Powers Phase 8 (cross-file duplicate methods) and Phase 11 (dependency cycles) below.
  // One index per workspace root (multi-root), started lazily when a root becomes the active
  // project. Fails soft: commands report the precise state (starting / unsupported + reason /
  // failed) rather than the extension crashing if native modules can't load, and an
  // unsupported runtime is surfaced to the user once instead of silently disabling the feature.
  // Initial root deferred 5s: heaviest startup cost (tree-sitter + SQLite + full scan); core
  // features (hovers, navigation, linting) work fine without it.
  const persistentIndexes = new PersistentIndexRegistry<PersistentIndexManager>(
    root => PersistentIndexManager.activate(context, root),
    (root, state) => {
      architectureTreeProvider.refresh(env)
      if (state.status === 'unsupported') {
        void notifyAstIndexUnavailable(context, state.reason, true)
      } else if (state.status === 'failed') {
        void notifyAstIndexUnavailable(context, `${path.basename(root)}: ${state.reason}`, false)
      }
    },
  )
  context.subscriptions.push(persistentIndexes)
  if (workspaceRoot) {
    setTimeout(() => void persistentIndexes.ensure(workspaceRoot), 5000)
  }

  // Offline DevDocs: downloads (or reuses an already-cached) docset in the background,
  // then swaps that project's index so DevDocsHoverProvider picks it up without a
  // window reload (per root: a root's docs load when it first becomes the active project). Silent on failure/offline — APIDock/RubyDoc's network-backed hovers
  // and the live `railsforge.openDevDocs` webview keep working regardless.
  // Deferred 5s: network I/O that can safely wait until core features are up.
  if (workspaceRoot && config.devdocsOfflineEnabled) {
    setTimeout(() => void devDocsProjects.get(workspaceRoot).refresh(false), 5000)
  }

  // 2. Initial Indexing & Live Workspace Analysis
  // Staggered to avoid blocking the extension host and the "thundering herd" problem
  // where every indexer races for CPU/disk simultaneously on a large monolith.
  if (workspaceRoot) {
    void handleWorkspaceAutoOptimization(config.performanceAutoOptimizeWorkspace, env.hasRails)

    // Stage 1 (immediate, deferred): Schema + Routes — small files, needed for hovers.
    setImmediate(() => {
      void loadSchema(workspaceRoot, schemaIndexer)
      void loadRoutes(workspaceRoot, routesIndexer)
    })

    // Stage 2 (500ms): Secondary indices — stimulus controllers, factories.
    setTimeout(() => {
      loadStimulusControllers(workspaceRoot, stimulusIndexer)
      factoryBotResolver.indexFactories(workspaceRoot)
    }, 500)

    // Stage 3 (2s): Heavy workspace-wide scanning — pattern/spec/turbo indexing.
    // Each uses async file I/O internally so they don't block the event loop.
    setTimeout(() => {
      void loadProjectPatterns(projectPatternIndexer, patternCodeLensProvider, dependencyGraph, dependencyDiagnostics, relatedCodeLensProvider, semanticSearchIndex)
      void loadSpecFiles(relatedFilesIndex, relatedCodeLensProvider)
      void loadTurboFrames(turboFrameNavigator)
    }, 2000)

    // File watchers are cheap to register, do immediately.
    watchProjectFiles(context, () => activeProject.root, schemaIndexer, routesIndexer, migrationDiagnostics, (root, kind) => { semanticContexts.get(root).invalidateSemanticGraph(); virtualDocs.refresh(root, [kind, 'graph']) })
    watchPatternFiles(context, projectPatternIndexer, patternCodeLensProvider, dependencyGraph, dependencyDiagnostics, relatedCodeLensProvider, semanticSearchIndex)
    watchSpecFiles(context, relatedFilesIndex, relatedCodeLensProvider)
    watchStimulusControllers(context, stimulusIndexer, () => activeProject.root)
    watchTurboFrameTemplates(context, turboFrameNavigator)
  }

  // 3. Activity Bar Tree Views
  const architectureTreeProvider = new RailsArchitectureTreeProvider(
    env,
    schemaIndexer,
    routesIndexer,
    stimulusIndexer,
    () => describeAstIndex(persistentIndexes.state(activeProject.root)),
    () => describeToolchain(activeProject.root),
  )
  // Pattern catalog: explanations open in the editor; pattern nodes expand to this project's own
  // classes. The per-root index is cached and dropped when matching files change.
  const patternIndexCache = new Map<string, ProjectPatternIndexer>()
  const patternCatalogTree = new PatternCatalogTreeProvider({
    getRoot: () => activeWorkspaceRoot(),
    loadInstances: (root, kind) => {
      let index = patternIndexCache.get(root)
      if (!index) {
        index = semanticContexts.get(root).loadPatternIndexer()
        patternIndexCache.set(root, index)
      }
      return toProjectInstances(index.getPatternsByType(kind), root)
    },
  })
  let patternRefreshTimer: NodeJS.Timeout | undefined
  const invalidatePatterns = (): void => {
    clearTimeout(patternRefreshTimer)
    patternRefreshTimer = setTimeout(() => { patternIndexCache.clear(); patternCatalogTree.refresh() }, 300)
  }
  const patternWatcher = vscode.workspace.createFileSystemWatcher('**/{services,queries,forms,policies,decorators,concerns}/**/*.rb')
  context.subscriptions.push(
    patternWatcher,
    patternWatcher.onDidCreate(invalidatePatterns),
    patternWatcher.onDidChange(invalidatePatterns),
    patternWatcher.onDidDelete(invalidatePatterns),
    { dispose: () => clearTimeout(patternRefreshTimer) },
    vscode.commands.registerCommand('railsforge.openPattern', async (id: string) => {
      const root = activeWorkspaceRoot()
      if (!root || !getCatalogPattern(id)) { return }
      const doc = await vscode.workspace.openTextDocument(patternDocUri(id, root))
      await vscode.window.showTextDocument(doc, { preview: true })
    }),
    vscode.commands.registerCommand('railsforge.explainPattern', async (target: PatternItem | string) => {
      const pattern = getCatalogPattern(typeof target === 'string' ? target : target?.patternId ?? '')
      if (!pattern) { return }
      // Only the catalog text is sent: no file, schema, routes or project context (isolated).
      await chatViewProvider.sendExternalPrompt(explainPatternPrompt(pattern), { isolated: true })
    }),
  )

  const rakeTaskIndexer = new RakeTaskIndexer()
  const rakeTaskTreeProvider = new RakeTaskTreeProvider(rakeTaskIndexer, workspaceRoot)

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('railsforge.architectureView', architectureTreeProvider),
    vscode.window.registerTreeDataProvider('railsforge.patternCatalogView', patternCatalogTree),
    vscode.window.registerTreeDataProvider('railsforge.rakeTasksView', rakeTaskTreeProvider),
  )
  void vscode.commands.executeCommand('setContext', 'railsforge.hasRakefile', workspaceRoot && fs.existsSync(path.join(workspaceRoot, 'Rakefile')))

  // Multi-root: schema/routes/env/stimulus/factories/rake are per-project. They are
  // shared singletons injected into many providers, so rather than rewiring each one we
  // re-point them (in place) at whichever workspace folder owns the active editor.
  const switchActiveProject = (newRoot: string): void => {
    if (!newRoot || newRoot === activeProject.root) {return}
    Logger.info(`[workspace] Active project: ${activeProject.root} -> ${newRoot}`)
    activeProject.root = newRoot
    patternCatalogTree.refresh()

    const fresh = envDetector.detectEnvironment(newRoot)
    const override = readConfig().projectTypeOverride
    if (override !== 'auto') {fresh.projectType = override}
    Object.assign(env, fresh)
    void vscode.commands.executeCommand('setContext', 'railsforge.projectType', env.projectType)
    void vscode.commands.executeCommand('setContext', 'railsforge.isRailsApp', env.projectType === 'monolith' || env.projectType === 'api_only')
    void vscode.commands.executeCommand('setContext', 'railsforge.hasViews', env.projectType === 'monolith')
    void vscode.commands.executeCommand('setContext', 'railsforge.hasHotwire', env.hasHotwire)
    void vscode.commands.executeCommand('setContext', 'railsforge.hasPundit', env.hasPundit)
    void vscode.commands.executeCommand('setContext', 'railsforge.hasViewComponent', env.hasViewComponent)
    void vscode.commands.executeCommand('setContext', 'railsforge.hasRakefile', fs.existsSync(path.join(newRoot, 'Rakefile')))

    void loadSchema(newRoot, schemaIndexer)
    void loadRoutes(newRoot, routesIndexer)
    stimulusIndexer.clear()
    loadStimulusControllers(newRoot, stimulusIndexer)
    factoryBotResolver.indexFactories(newRoot)
    rakeTaskTreeProvider.setRoot(newRoot)
    void persistentIndexes.ensure(newRoot)
    rbsIndexes.get(newRoot)
    if (readConfig().devdocsOfflineEnabled) {void devDocsProjects.get(newRoot).refresh(false)}
    architectureTreeProvider.refresh(env)
  }
  const syncActiveProject = (uri: vscode.Uri | undefined): void => {
    const root = resolveWorkspaceRoot(uri?.fsPath, workspaceRoots())
    if (root) {switchActiveProject(root)}
  }
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => syncActiveProject(editor?.document.uri)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      // Tear down the AST index (worker + watchers) of any folder that was removed.
      const open = new Set(workspaceRoots())
      for (const root of persistentIndexes.roots()) {
        if (!open.has(root)) {persistentIndexes.release(root)}
      }
      devDocsProjects.retainOnly(open)
      rbsIndexes.retainOnly(open)
      // Active project's folder was removed: fall back to whatever now owns the editor / first folder.
      if (!workspaceRoots().includes(activeProject.root)) {
        const next = activeWorkspaceRoot()
        if (next) {switchActiveProject(next)}
      }
    }),
  )


  // 3. Register Providers
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ language: 'ruby', scheme: 'file' }, new SchemaHoverProvider(schemaIndexer)),
    vscode.languages.registerHoverProvider({ language: 'ruby', scheme: 'file' }, docsEngine),
    vscode.languages.registerHoverProvider({ language: 'ruby', scheme: 'file' }, new GemLensProvider(rubyGemsClient)),
    vscode.languages.registerHoverProvider(
      { language: 'ruby', scheme: 'file' },
      new DevDocsHoverProvider(devDocsIndexFor, () => readConfig().devdocsOfflineEnabled),
    ),
    vscode.languages.registerHoverProvider(
      { language: 'ruby', scheme: 'file' },
      new ApiDockHoverProvider(apiDockClient, apiDockMethodIndex, () => readConfig().apidockEnabled),
    ),
    vscode.languages.registerHoverProvider({ language: 'ruby', scheme: 'file' }, new RBSHoverProvider(rbsIndexFor)),
    vscode.languages.registerDefinitionProvider({ language: 'ruby', scheme: 'file' }, new RBSDefinitionProvider(rbsIndexFor)),
    vscode.languages.registerDefinitionProvider({ language: 'ruby', scheme: 'file' }, factoryBotResolver),
    vscode.languages.registerDefinitionProvider(['erb', 'haml', 'slim', 'html'], new StimulusDefinitionProvider(stimulusIndexer)),
    vscode.languages.registerDefinitionProvider(['erb', 'haml', 'slim', 'html', 'ruby'], new TurboFrameDefinitionProvider(turboFrameNavigator)),
    vscode.languages.registerDefinitionProvider(['erb', 'haml', 'slim', 'ruby'], new ViewPartialDefinitionProvider(viewPartialResolver)),
    vscode.languages.registerCodeActionsProvider({ language: 'ruby', scheme: 'file' }, rubocopProvider),
    vscode.languages.registerCodeActionsProvider({ language: 'ruby', scheme: 'file' }, migrationDiagnostics),
    vscode.languages.registerCodeActionsProvider({ language: 'ruby', scheme: 'file' }, deprecationLinter),
    vscode.languages.registerCodeActionsProvider({ language: 'ruby', scheme: 'file' }, principleLinter, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorExtract],
    }),
    vscode.languages.registerCodeActionsProvider({ language: 'ruby', scheme: 'file' }, patternDiagnostics),
    vscode.languages.registerCodeActionsProvider({ language: 'ruby', scheme: 'file' }, dependencyDiagnostics, {
      providedCodeActionKinds: [vscode.CodeActionKind.Refactor],
    }),
    vscode.languages.registerCompletionItemProvider(
      ['erb', 'html', 'ruby'],
      new StimulusCompletionProvider(stimulusIndexer),
      '"',
      '\'',
      '=',
    ),
    vscode.languages.registerCompletionItemProvider('erb', new ErbTagCompletionProvider(), '%'),
    vscode.languages.registerCompletionItemProvider(
      { language: 'ruby', scheme: 'file' },
      new RouteHelperCompletionProvider(routesIndexer),
      '_',
    ),
    vscode.languages.registerOnTypeFormattingEditProvider({ language: 'ruby', scheme: 'file' }, new EndwiseProvider(), '\n'),
    vscode.languages.registerCodeLensProvider({ language: 'ruby', scheme: 'file' }, new TestCodeLensProvider()),
    vscode.languages.registerCodeLensProvider({ language: 'ruby', scheme: 'file' }, patternCodeLensProvider),
    vscode.languages.registerCodeLensProvider({ language: 'ruby', scheme: 'file' }, relatedCodeLensProvider),
    vscode.languages.registerHoverProvider({ language: 'ruby', scheme: 'file' }, relatedHoverProvider),
    testExplorer.getController(),
    migrationDiagnostics,
    deprecationLinter,
    principleLinter,
    patternDiagnostics,
    dependencyDiagnostics,
    rubocopProvider,
  )

  // 4. Live Document Watchers for Diagnostics & Design Pattern Suggestions
  // All diagnostics are debounced to prevent blocking the UI on every keystroke.
  const lintTimers = new Map<string, NodeJS.Timeout>()
  const scheduleDiagnostics = (doc: vscode.TextDocument, delayMs: number): void => {
    if (doc.languageId !== 'ruby' && doc.languageId !== 'erb') {return}
    const key = `diag:${doc.uri.toString()}`
    const existing = lintTimers.get(key)
    if (existing) {clearTimeout(existing)}
    lintTimers.set(key, setTimeout(() => {
      lintTimers.delete(key)
      migrationDiagnostics.updateDiagnostics(doc)
      deprecationLinter.updateDiagnostics(doc, env)
      principleLinter.updateDiagnostics(doc)
      patternDiagnostics.updateDiagnostics(doc)
      dependencyDiagnostics.updateDiagnostics(doc)
    }, delayMs))
  }
  const scheduleRubocopLint = (doc: vscode.TextDocument, delayMs: number): void => {
    if (doc.languageId !== 'ruby') {return}
    const key = `rubocop:${doc.uri.toString()}`
    const existing = lintTimers.get(key)
    if (existing) {clearTimeout(existing)}
    lintTimers.set(key, setTimeout(() => {
      lintTimers.delete(key)
      void rubocopProvider.lintDocument(doc)
    }, delayMs))
  }

  vscode.workspace.onDidOpenTextDocument(doc => {
    if (doc.languageId !== 'ruby' && doc.languageId !== 'erb') {return}
    testExplorer.discoverTestsInDocument(doc)
    scheduleDiagnostics(doc, 100)
    scheduleRubocopLint(doc, 200)
  }, null, context.subscriptions)

  vscode.workspace.onDidChangeTextDocument(e => {
    scheduleDiagnostics(e.document, 300)
    scheduleRubocopLint(e.document, 500)
  }, null, context.subscriptions)

  let lastBrakemanScanOnSave = 0
  let lastSteepScanOnSave = 0
  vscode.workspace.onDidSaveTextDocument(doc => {
    if (doc.languageId !== 'ruby') {return}
    const saveConfig = readConfig()
    if (saveConfig.rubocopAutocorrectOnSave) {
      void rubocopProvider.autoCorrectFile(doc.uri, saveConfig.rubocopMode)
    }
    void rubocopProvider.lintDocument(doc)
    if (saveConfig.brakemanScanOnSave && env.hasRails) {
      // Brakeman is a whole-project static scan (can take several seconds), so a save-
      // triggered run is debounced and silent-on-clean rather than firing (and popping a
      // doc open) on every keystroke-adjacent save the way a per-file linter would.
      const now = Date.now()
      if (now - lastBrakemanScanOnSave >= 30_000) {
        lastBrakemanScanOnSave = now
        const scanRoot = workspaceRootFor(doc.uri) ?? workspaceRoot
        void brakemanProvider.runScan(scanRoot).then(report => {
          if (report.warnings.length === 0) {return}
          void vscode.window
            .showWarningMessage(`RailsForge: Brakeman found ${report.warnings.length} security warning(s).`, 'Show Report')
            .then(choice => {
              if (choice !== 'Show Report') {return}
              void vscode.workspace
                .openTextDocument({ content: brakemanProvider.formatMarkdownReport(report), language: 'markdown' })
                .then(reportDoc => vscode.window.showTextDocument(reportDoc))
            })
        })
      }
    }
    if (saveConfig.typesSteepEnabled && saveConfig.typesSteepScanOnSave) {
      // Same debounce rationale as Brakeman above: Steep type-checks the whole configured
      // target, not just the saved file, so a save-triggered run needs a floor between runs.
      const now = Date.now()
      if (now - lastSteepScanOnSave >= 30_000) {
        lastSteepScanOnSave = now
        void updateSteepDiagnostics(steepProvider, steepDiagnostics, workspaceRootFor(doc.uri) ?? workspaceRoot)
      }
    }
  }, null, context.subscriptions)

  // 4. Register Commands
  registerCommands(
    context,
    mvcNavigator,
    routesIndexer,
    rubocopProvider,
    brakemanProvider,
    bundlerAuditScanner,
    strongMigrationsAnalyzer,
    policyNavigator,
    viewComponentResolver,
    turboFrameNavigator,
    refactoringMenu,
    patternDiagnostics,
    serviceExtractor,
    queryExtractor,
    projectPatternIndexer,
    agent,
    principleLinter,
    relatedFilesIndex,
    dependencyGraph,
    persistentIndexes,
    analyzers,
    schemaIndexer,
    env,
    semanticSearchIndex,
    rubyDocProvider,
    devDocsProjects,
    speculativeFixCache,
    rakeTaskTreeProvider,
    rbsIndexes,
    steepProvider,
    steepDiagnostics,
    getAgentConfig,
  )

  // 5. Register Chat Participant
  RailsChatParticipant.getInstance().register(
    context,
    agent,
    schemaIndexer,
    routesIndexer,
    () => env.testFramework,
    () => projectPatternIndexer.getAllPatterns().map(p => `${p.type}/${p.name}`),
  )

  // 6. Suggest the ruby-lsp add-on when ruby-lsp is present but the gem isn't
  if (workspaceRoot) {
    void suggestRubyLspAddon(context, workspaceRoot)
  }

  registerAgentIntegrations(context)

  // Read-only project overview documents (railsforge:/routes.md?root=…) and the empty-state view.
  const virtualDocs = new VirtualDocsProvider(semanticContexts)
  context.subscriptions.push(
    virtualDocs,
    vscode.workspace.registerTextDocumentContentProvider(VIRTUAL_DOC_SCHEME, virtualDocs),
    vscode.window.registerTreeDataProvider('railsforge.gettingStarted', {
      getTreeItem: item => item,
      getChildren: () => [],
    } satisfies vscode.TreeDataProvider<vscode.TreeItem>),
    vscode.commands.registerCommand('railsforge.openVirtualDoc', async (preselected?: VirtualDocKind) => {
      const root = activeWorkspaceRoot()
      if (!root) {return}
      const kind = preselected ?? (await vscode.window.showQuickPick(
        VIRTUAL_DOC_KINDS.map(k => ({ label: k, description: `railsforge:/${k}.md` })),
        { placeHolder: 'Open which project overview?' },
      ))?.label as VirtualDocKind | undefined
      if (!kind) {return}
      const doc = await vscode.workspace.openTextDocument(virtualDocUri(kind, root))
      await vscode.window.showTextDocument(doc, { preview: true })
    }),
  )
  context.subscriptions.push(vscode.tasks.registerTaskProvider(RAILSFORGE_TASK_TYPE, new RailsTaskProvider()))

  // 6. Status Bar
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBar.text = '$(ruby) RailsForge'
  statusBar.tooltip = 'RailsForge: Active'
  statusBar.show()
  context.subscriptions.push(statusBar)

  // 7. Provider Registry - the architectural firewall between VS Code APIs and the
  //    core engine. Wires the PrincipleCodeActionProvider (canonical example) plus
  //    the engine adapters (SemanticIndexAdapter wraps PersistentIndexManager +
  //    DesignPrincipleLinter; PatternCatalogAccessAdapter wraps PatternCatalog +
  //    ProjectPatternIndexer). Other providers (WorkspaceFs, SourceControl,
  //    TerminalTasks, WindowUi, TestingApi, AiChat) are opt-in flags that the
  //    engineering team can flip on as they migrate existing direct registrations
  //    in extension.ts to the new layer one at a time.
  const semanticIndexAdapter = new SemanticIndexAdapter(
    activeProject.root,
    persistentIndexes.get(activeProject.root) ?? undefined,
    principleLinter,
  )
  const patternCatalogAdapter = new PatternCatalogAccessAdapter(projectPatternIndexer)
  // Construct the shared RefactoringEditProvider outside the registry closure so its
  // reference is resolved before the registry's factory arrow function captures it.
  // This avoids the TS7022 "implicitly has type any" self-reference error.
  const sharedEditProvider = new RefactoringEditProvider()
  const providerRegistry = new ProviderRegistry({
    index: semanticIndexAdapter,
    catalog: patternCatalogAdapter,
    workspaceRoot: activeProject.root,
    languageIntelligence: {
      // Canonical example: a CodeActionProvider that consumes the SemanticIndex and
      // PatternCatalog, producing refactoring Quick Fixes ("Extract to Service",
      // "Fix Demeter Violation", "Inject Dependency", "Clone existing pattern") via
      // the RefactoringEditProvider (atomic, previewable WorkspaceEdits).
      codeActions: (index, catalog) => new PrincipleCodeActionProvider(index, catalog, sharedEditProvider),
    },
  })
  providerRegistry.activate()
  context.subscriptions.push(providerRegistry)

  return {
    getActiveProjectRoot: () => activeProject.root,
    getSchemaTableNames: () => schemaIndexer.getAllTables().map(t => t.name),
    countRbsMethods: (filePath, methodName) => rbsIndexFor(vscode.Uri.file(filePath)).lookup(methodName).length,
    getDevDocsCacheDir: filePath => devDocsProjects.get(workspaceRootFor(vscode.Uri.file(filePath)) ?? activeProject.root).cacheDir,
    discoverTestTree: async () => {
      await testExplorer.discoverWorkspace()
      const lines: string[] = []
      const walk = (item: vscode.TestItem, depth: number): void => {
        lines.push(`${'  '.repeat(depth)}${item.label}`)
        item.children.forEach(child => walk(child, depth + 1))
      }
      testExplorer.getController().items.forEach(item => walk(item, 0))
      return lines
    },
    getAstIndexStatuses: () => Object.fromEntries(persistentIndexes.roots().map(r => [r, persistentIndexes.state(r).status])),
  }
}

async function suggestRubyLspAddon(context: vscode.ExtensionContext, root: string): Promise<void> {
  const dismissedKey = 'railsforge.dismissedRubyLspAddonSuggestion'
  if (context.globalState.get<boolean>(dismissedKey)) {return}

  const rubyLspInstalled = Boolean(vscode.extensions.getExtension('Shopify.ruby-lsp'))
  if (!rubyLspInstalled) {return}

  const lockPath = path.join(root, 'Gemfile.lock')
  if (!fs.existsSync(lockPath)) {return}
  const lock = fs.readFileSync(lockPath, 'utf8')
  if (!lock.includes(' ruby-lsp ') || lock.includes('railsforge-ruby-lsp')) {return}

  const choice = await vscode.window.showInformationMessage(
    'RailsForge can add schema-aware hover directly into ruby-lsp via a small companion gem (railsforge-ruby-lsp). Add it to your Gemfile?',
    'Show Instructions',
    "Don't show again",
  )
  if (choice === 'Show Instructions') {
    void vscode.env.openExternal(vscode.Uri.parse('https://github.com/shubhamtaywade82/ruby-rails-extension/tree/master/ruby-lsp-addon'))
  }
  if (choice) {
    void context.globalState.update(dismissedKey, true)
  }
}

/** One-line description of how project tools are launched (version manager + binstub preference). */
function describeToolchain(root: string): string {
  const manager = projectVersionManager(root)
  const launcher = fs.existsSync(path.join(root, 'bin', 'rails')) ? 'bin/ stubs' : fs.existsSync(path.join(root, 'Gemfile')) ? 'bundle exec' : 'bare tools'
  return `${manager === 'none' ? 'no version manager' : manager} · ${launcher}`
}

function describeAstIndex(state: IndexState<PersistentIndexManager>): string {
  switch (state.status) {
    case 'ready': return 'Ready ✓'
    case 'starting': return 'Indexing…'
    case 'unsupported': return `Unavailable — ${state.reason}`
    case 'failed': return `Failed — ${state.reason}`
    case 'idle': return 'Not started'
  }
}

let astNoticeShownThisSession = false

/**
 * Tells the user the AST features are off and why (the native SQLite module can't load on
 * this VS Code runtime), instead of failing silently. The runtime-wide "unsupported" case is
 * shown once per session and can be dismissed permanently; per-root failures always show.
 */
async function notifyAstIndexUnavailable(context: vscode.ExtensionContext, reason: string, runtimeWide: boolean): Promise<void> {
  const dismissedKey = 'railsforge.dismissedAstUnavailableNotice'
  if (runtimeWide) {
    if (astNoticeShownThisSession || context.globalState.get<boolean>(dismissedKey)) {return}
    astNoticeShownThisSession = true
  }
  const message = runtimeWide
    ? `RailsForge: the AST index is unavailable — ${reason} "Find Duplicate Methods" and "Show Dependency Cycles" are disabled; all other RailsForge features work normally.`
    : `RailsForge: the AST index failed to start (${reason}). "Find Duplicate Methods" and "Show Dependency Cycles" are disabled for this project.`
  const choice = await vscode.window.showWarningMessage(message, 'Show Log', ...(runtimeWide ? ["Don't show again"] : []))
  if (choice === 'Show Log') {Logger.show(false)}
  if (choice === "Don't show again") {await context.globalState.update(dismissedKey, true)}
}

/** Ready AST index for the active project, or null after telling the user exactly why not. */
function requireAstIndex(registry: PersistentIndexRegistry<PersistentIndexManager>): PersistentIndexManager | null {
  const root = activeWorkspaceRoot()
  if (!root) {
    vscode.window.showWarningMessage('RailsForge: Open a Ruby project to use the AST index.')
    return null
  }
  const state = registry.state(root)
  switch (state.status) {
    case 'ready':
      return state.manager
    case 'starting':
      vscode.window.showInformationMessage('RailsForge: The AST index is still indexing this project — try again shortly.')
      return null
    case 'unsupported':
      vscode.window.showWarningMessage(`RailsForge: AST features are unavailable — ${state.reason}`)
      return null
    case 'failed':
      vscode.window.showWarningMessage(`RailsForge: The AST index failed to start (${state.reason}). See the RailsForge output log.`, 'Retry')
        .then(choice => { if (choice === 'Retry') {void registry.ensure(root)} })
      return null
    case 'idle':
      void registry.ensure(root)
      vscode.window.showInformationMessage('RailsForge: Starting the AST index for this project — try again shortly.')
      return null
  }
}

function loadStimulusControllers(root: string, indexer: StimulusIndexer): void {
  const controllersDir = path.join(root, 'app', 'javascript', 'controllers')
  if (!fs.existsSync(controllersDir)) {return}
  // Recursive, matching the watcher glob — nested controllers (admin/foo_controller.js)
  // must be indexed at startup, not only after their first edit.
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') {walk(full)}
      } else if (/_controller\.[jt]s$/.test(entry.name) && !isExcludedByConfig(full)) {
        try {
          indexer.parseControllerCode(full, fs.readFileSync(full, 'utf8'))
        } catch { /* skip unreadable */ }
      }
    }
  }
  walk(controllersDir)
}

function watchStimulusControllers(context: vscode.ExtensionContext, indexer: StimulusIndexer, getRoot: () => string): void {
  const watcher = vscode.workspace.createFileSystemWatcher('**/app/javascript/controllers/**/*_controller.{js,ts}')
  const reindex = async (uri: vscode.Uri): Promise<void> => {
    if (isExcludedByConfig(uri.fsPath) || !isInside(getRoot(), uri.fsPath)) {return}
    try {
      if (fs.existsSync(uri.fsPath)) {
        const code = await fs.promises.readFile(uri.fsPath, 'utf8')
        indexer.parseControllerCode(uri.fsPath, code)
      }
    } catch { /* skip unreadable */ }
  }
  watcher.onDidChange(uri => void reindex(uri))
  watcher.onDidCreate(uri => void reindex(uri))
  watcher.onDidDelete(uri => indexer.removeFile(uri.fsPath))
  context.subscriptions.push(watcher)
}

type VsCodeLmApi = { selectChatModels?: (selector?: { family?: string }) => Thenable<vscode.LanguageModelChat[]> }

async function selectVsCodeLmModel(family: string): Promise<vscode.LanguageModelChat | undefined> {
  const lm = (vscode as unknown as { lm?: VsCodeLmApi }).lm
  if (typeof lm?.selectChatModels !== 'function') {return undefined}
  const models = await lm.selectChatModels(family ? { family } : undefined)
  return models[0]
}

/** One system+user request through VS Code's Language Model API (the user is asked for consent on first use). */
async function requestViaVsCodeLm(system: string, prompt: string, family: string, timeoutMs: number): Promise<string> {
  const model = await selectVsCodeLmModel(family)
  if (!model) {
    throw new Error(family
      ? `No VS Code language model matches family "${family}". Install/sign in to a model provider or change railsForge.ai.vscodeLm.family.`
      : 'No VS Code language model is available. Sign in to Copilot or install a Language Model provider extension.')
  }
  const source = new vscode.CancellationTokenSource()
  const timer = setTimeout(() => source.cancel(), timeoutMs)
  try {
    // The Language Model API has no system role: fold the system prompt into the first user message.
    const messages = [vscode.LanguageModelChatMessage.User(`${system}\n\n---\n\n${prompt}`)]
    const response = await model.sendRequest(messages, { justification: 'RailsForge needs a model to answer your Rails question.' }, source.token)
    let text = ''
    for await (const chunk of response.text) {text += chunk}
    return text
  } finally {
    clearTimeout(timer)
    source.dispose()
  }
}

async function vscodeLmStatus(family: string): Promise<{ state: 'authenticated' | 'error'; detail?: string }> {
  try {
    const model = await selectVsCodeLmModel(family)
    return model
      ? { state: 'authenticated', detail: `${model.name} (${model.vendor})` }
      : { state: 'error', detail: family ? `No model for family "${family}"` : 'No VS Code language model available' }
  } catch (err) {
    return { state: 'error', detail: err instanceof Error ? err.message : String(err) }
  }
}

/** SecretStorage key for a given AI provider's API key — never the same key across providers, so switching providers doesn't require re-entering the other one's key. */
function aiApiKeySecretKey(provider: AiProvider): string {
  return `railsForge.aiApiKey.${provider}`
}

/** Resolves `railsForge.excludePatterns` (read fresh, so a settings change applies to the next scan) into the glob `findFiles` expects. */
function resolveExcludeGlob(): string | undefined {
  return buildExcludeGlob(readConfig().excludePatterns) ?? undefined
}

/**
 * File-system watchers can't take an exclude glob the way `findFiles` can, so a save
 * inside an excluded directory (e.g. a vendored gem under vendor/bundle/.../app/services)
 * would otherwise slip into live re-indexing even though the initial workspace-wide scan
 * skipped it. Reindex callbacks call this first so both paths stay consistent.
 */
function isExcludedByConfig(fsPath: string): boolean {
  return isExcludedPath(fsPath, readConfig().excludePatterns)
}

async function loadTurboFrames(navigator: TurboFrameNavigator): Promise<void> {
  const files = await vscode.workspace.findFiles('app/views/**/*.{erb,haml,slim}', resolveExcludeGlob())
  for (const file of files) {
    try {
      const content = await fs.promises.readFile(file.fsPath, 'utf8')
      navigator.indexTemplateFrames(file.fsPath, content)
    } catch { /* skip unreadable */ }
  }
}

function watchTurboFrameTemplates(context: vscode.ExtensionContext, navigator: TurboFrameNavigator): void {
  const watcher = vscode.workspace.createFileSystemWatcher('**/app/views/**/*.{erb,haml,slim}')
  const reindex = async (uri: vscode.Uri): Promise<void> => {
    if (isExcludedByConfig(uri.fsPath)) {return}
    try {
      if (fs.existsSync(uri.fsPath)) {
        const content = await fs.promises.readFile(uri.fsPath, 'utf8')
        navigator.indexTemplateFrames(uri.fsPath, content)
      } else {
        navigator.removeFile(uri.fsPath)
      }
    } catch { /* skip unreadable */ }
  }
  watcher.onDidChange(uri => void reindex(uri))
  watcher.onDidCreate(uri => void reindex(uri))
  watcher.onDidDelete(uri => navigator.removeFile(uri.fsPath))
  context.subscriptions.push(watcher)
}

async function loadProjectPatterns(
  indexer: ProjectPatternIndexer,
  codeLensProvider: PatternCodeLensProvider,
  dependencyGraph: MinimalDependencyGraph,
  dependencyDiagnostics: DependencyDiagnosticsProvider,
  relatedCodeLensProvider: RelatedCodeLensProvider,
  semanticSearchIndex: SemanticSearchIndex,
): Promise<void> {
  const globs = [
    '{app,lib}/**/services/**/*.rb',
    '{app,lib}/**/queries/**/*.rb',
    '{app,lib}/**/forms/**/*.rb',
    '{app,lib}/**/policies/**/*.rb',
    '{app,lib}/**/decorators/**/*.rb',
    '{app,lib}/**/concerns/**/*.rb',
  ]

  const excludeGlob = resolveExcludeGlob()
  for (const glob of globs) {
    const files = await vscode.workspace.findFiles(glob, excludeGlob)
    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file.fsPath, 'utf8')
        indexer.indexFile(file.fsPath, content)
      } catch { /* skip unreadable */ }
    }
  }
  codeLensProvider.refresh()
  void dependencyGraph.rebuild()
  refreshOpenDependencyDiagnostics(dependencyDiagnostics)
  relatedCodeLensProvider.refresh()
  semanticSearchIndex.pruneStale()
}

async function loadSpecFiles(relatedFilesIndex: RelatedFilesIndex, relatedCodeLensProvider: RelatedCodeLensProvider): Promise<void> {
  const excludeGlob = resolveExcludeGlob()
  const files = await vscode.workspace.findFiles('spec/**/*_spec.rb', excludeGlob)
  for (const file of files) {
    try {
      const content = await fs.promises.readFile(file.fsPath, 'utf8')
      relatedFilesIndex.indexSpecFile(file.fsPath, content)
    } catch { /* skip unreadable */ }
  }
  const testFiles = await vscode.workspace.findFiles('test/**/*_test.rb', excludeGlob)
  for (const file of testFiles) {
    try {
      const content = await fs.promises.readFile(file.fsPath, 'utf8')
      relatedFilesIndex.indexSpecFile(file.fsPath, content)
    } catch { /* skip unreadable */ }
  }
  relatedCodeLensProvider.refresh()
}

function watchSpecFiles(context: vscode.ExtensionContext, relatedFilesIndex: RelatedFilesIndex, relatedCodeLensProvider: RelatedCodeLensProvider): void {
  const watcher = vscode.workspace.createFileSystemWatcher('**/{spec/**/*_spec.rb,test/**/*_test.rb}')
  let refreshTimer: NodeJS.Timeout | undefined
  const scheduleRefresh = (): void => {
    if (refreshTimer) {clearTimeout(refreshTimer)}
    refreshTimer = setTimeout(() => relatedCodeLensProvider.refresh(), 200)
  }

  const reindex = async (uri: vscode.Uri): Promise<void> => {
    if (isExcludedByConfig(uri.fsPath)) {return}
    try {
      if (fs.existsSync(uri.fsPath)) {
        const content = await fs.promises.readFile(uri.fsPath, 'utf8')
        relatedFilesIndex.indexSpecFile(uri.fsPath, content)
      } else {
        relatedFilesIndex.removeSpecFile(uri.fsPath)
      }
      scheduleRefresh()
    } catch { /* skip unreadable */ }
  }
  watcher.onDidChange(uri => void reindex(uri))
  watcher.onDidCreate(uri => void reindex(uri))
  watcher.onDidDelete(uri => {
    relatedFilesIndex.removeSpecFile(uri.fsPath)
    scheduleRefresh()
  })
  context.subscriptions.push(watcher)
}

function watchPatternFiles(
  context: vscode.ExtensionContext,
  indexer: ProjectPatternIndexer,
  codeLensProvider: PatternCodeLensProvider,
  dependencyGraph: MinimalDependencyGraph,
  dependencyDiagnostics: DependencyDiagnosticsProvider,
  relatedCodeLensProvider: RelatedCodeLensProvider,
  semanticSearchIndex: SemanticSearchIndex,
): void {
  const watcher = vscode.workspace.createFileSystemWatcher(
    '**/{app,lib}/**/{services,queries,forms,policies,decorators,concerns}/**/*.rb',
  )
  let rebuildTimer: NodeJS.Timeout | undefined
  const scheduleRebuild = (): void => {
    if (rebuildTimer) {clearTimeout(rebuildTimer)}
    rebuildTimer = setTimeout(() => {
      codeLensProvider.refresh()
      void dependencyGraph.rebuild()
      refreshOpenDependencyDiagnostics(dependencyDiagnostics)
      relatedCodeLensProvider.refresh()
      semanticSearchIndex.pruneStale()
    }, 300)
  }

  const reindex = async (uri: vscode.Uri): Promise<void> => {
    if (isExcludedByConfig(uri.fsPath)) {return}
    try {
      if (fs.existsSync(uri.fsPath)) {
        const content = await fs.promises.readFile(uri.fsPath, 'utf8')
        indexer.indexFile(uri.fsPath, content)
      } else {
        indexer.removeFile(uri.fsPath)
      }
      scheduleRebuild()
    } catch { /* skip unreadable */ }
  }
  watcher.onDidChange(uri => void reindex(uri))
  watcher.onDidCreate(uri => void reindex(uri))
  watcher.onDidDelete(uri => {
    indexer.removeFile(uri.fsPath)
    scheduleRebuild()
  })
  context.subscriptions.push(watcher)
}

function refreshOpenDependencyDiagnostics(dependencyDiagnostics: DependencyDiagnosticsProvider): void {
  for (const doc of vscode.workspace.textDocuments) {
    dependencyDiagnostics.updateDiagnostics(doc)
  }
}

/**
 * Phase 13: after extracting a Service/Query, checks whether the exact same code was
 * copy-pasted elsewhere in the workspace and, if the developer opts in, replaces those
 * call sites too — added to the same WorkspaceEdit as the primary extraction so it's
 * one multi-file diff preview, not several separate edits.
 */
async function maybeReplaceDuplicateCallSites(
  edit: vscode.WorkspaceEdit,
  selection: string,
  replacementCall: string,
  excludeUri: vscode.Uri,
): Promise<void> {
  const files = await vscode.workspace.findFiles('{app,lib}/**/*.rb', resolveExcludeGlob())
  const contents = new Map<string, string>()
  for (const file of files) {
    if (file.fsPath === excludeUri.fsPath) {continue}
    try {
      contents.set(file.fsPath, fs.readFileSync(file.fsPath, 'utf8'))
    } catch {
      // Unreadable file — skip it rather than aborting the whole search.
    }
  }

  const duplicates = findDuplicateCallSites(selection, contents, excludeUri.fsPath)
  if (duplicates.length === 0) {return}

  const choice = await vscode.window.showWarningMessage(
    `RailsForge: Found ${duplicates.length} other occurrence(s) of this exact code elsewhere in the workspace. Replace them too?`,
    'Replace All',
    'Just This One',
  )
  if (choice !== 'Replace All') {return}

  for (const dup of duplicates) {
    const doc = await vscode.workspace.openTextDocument(dup.filePath)
    const start = doc.positionAt(dup.index)
    const end = doc.positionAt(dup.index + dup.length)
    edit.replace(doc.uri, new vscode.Range(start, end), replacementCall)
  }
}

/**
 * Phase 13: generates a companion RSpec skeleton for a newly extracted Service/Query,
 * added to the same WorkspaceEdit — only when the workspace actually has a spec/
 * directory, and only if a spec for that file doesn't already exist.
 */
function maybeGenerateSpec(
  edit: vscode.WorkspaceEdit,
  extractedFilePath: string,
  root: string,
  kind: 'service' | 'query',
  className: string,
): void {
  if (!fs.existsSync(path.join(root, 'spec'))) {return}

  const specPath = specFilePathFor(extractedFilePath, root, kind)
  if (fs.existsSync(specPath)) {return}

  const specUri = vscode.Uri.file(specPath)
  edit.createFile(specUri, { ignoreIfExists: true })
  edit.insert(specUri, new vscode.Position(0, 0), buildRspecSkeleton(className, kind, 'call'))
}

/**
 * Merge-writes the `railsforge` entry into .cursor/mcp.json without clobbering any
 * other MCP servers the user already has configured there.
 */
function registerMcpServer(root: string, mcpServerPath: string): void {
  const mcpConfigPath = path.join(root, '.cursor', 'mcp.json')
  let config: { mcpServers?: Record<string, unknown> } = {}
  if (fs.existsSync(mcpConfigPath)) {
    try {
      config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'))
    } catch {
      config = {}
    }
  }

  config.mcpServers = {
    ...config.mcpServers,
    railsforge: {
      command: 'node',
      args: [mcpServerPath],
      env: { RAILSFORGE_WORKSPACE_ROOT: root },
    },
  }

  fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true })
  fs.writeFileSync(mcpConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

async function updateSteepDiagnostics(
  steepProvider: SteepProvider,
  collection: vscode.DiagnosticCollection,
  workspaceRoot: string,
): Promise<number> {
  const diagnostics = await steepProvider.runCheck(workspaceRoot)

  const byFile = new Map<string, vscode.Diagnostic[]>()
  for (const diag of diagnostics) {
    const absolutePath = path.isAbsolute(diag.file) ? diag.file : path.join(workspaceRoot, diag.file)
    const range = new vscode.Range(
      new vscode.Position(Math.max(0, diag.line - 1), Math.max(0, diag.col - 1)),
      new vscode.Position(Math.max(0, diag.endLine - 1), diag.endColumn),
    )
    const severity = diag.severity === 'error' ? vscode.DiagnosticSeverity.Error
      : diag.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information
    const vscodeDiag = new vscode.Diagnostic(range, diag.message, severity)
    vscodeDiag.source = 'Steep'

    const list = byFile.get(absolutePath) ?? []
    list.push(vscodeDiag)
    byFile.set(absolutePath, list)
  }

  collection.clear()
  for (const [file, fileDiagnostics] of byFile) {
    collection.set(vscode.Uri.file(file), fileDiagnostics)
  }
  return diagnostics.length
}

async function loadSchema(root: string, indexer: SchemaIndexer): Promise<void> {
  const schemaPath = path.join(root, 'db', 'schema.rb')
  try {
    const content = await fs.promises.readFile(schemaPath, 'utf8')
    indexer.parseSchema(content)
  } catch {
    // db/schema.rb does not exist — drop any state from a previously active project
    indexer.parseSchema('')
  }
}

async function loadRoutes(root: string, indexer: RoutesIndexer): Promise<void> {
  const routesPath = path.join(root, 'config', 'routes.rb')
  try {
    const content = await fs.promises.readFile(routesPath, 'utf8')
    indexer.parseRoutesDsl(content)
  } catch {
    // config/routes.rb does not exist — drop any state from a previously active project
    indexer.parseRoutesDsl('')
  }
}

export interface LineDiffHunk {
  startLine: number
  removedCount: number
  inserted: string[]
}

/** Line-based diff (LCS) between two texts; returns non-overlapping hunks that transform `oldText` into `newText`. */
export function diffLines(oldText: string, newText: string): LineDiffHunk[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const m = oldLines.length
  const n = newLines.length

  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = oldLines[i] === newLines[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const hunks: LineDiffHunk[] = []
  let i = 0
  let j = 0
  let open: LineDiffHunk | null = null
  const flush = (): void => {
    if (open && (open.removedCount > 0 || open.inserted.length > 0)) {hunks.push(open)}
    open = null
  }
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      flush()
      i++
      j++
      continue
    }
    if (!open) {open = { startLine: i, removedCount: 0, inserted: [] }}
    if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      open.removedCount++
      i++
    } else {
      open.inserted.push(newLines[j])
      j++
    }
  }
  if (open) {
    open.removedCount += m - i
    open.inserted.push(...newLines.slice(j))
    flush()
  } else if (i < m || j < n) {
    hunks.push({ startLine: i, removedCount: m - i, inserted: newLines.slice(j) })
  }
  return hunks
}

/**
 * Keeps only hunks that overlap the reported diagnostic range (0-based lines).
 * Hunks outside it are the model's unrelated edits (reformatting, renames,
 * whole-file rewrites) and must never be applied — that's what makes an AI fix
 * minimal instead of a noisy rewrite.
 */
export function filterFixHunks(hunks: LineDiffHunk[], range: { startLine: number; endLine: number }): { keep: LineDiffHunk[]; skipped: number } {
  const keep: LineDiffHunk[] = []
  let skipped = 0
  for (const h of hunks) {
    const hunkEnd = h.startLine + Math.max(h.removedCount, 1) - 1
    if (h.startLine <= range.endLine && hunkEnd >= range.startLine) {keep.push(h)}
    else {skipped++}
  }
  return { keep, skipped }
}

/**
 * Applies hunks to `fullText` and returns the resulting text. Lossless: applying
 * `diffLines(a, b)` to `a` always yields `b`, so the applied result is exactly
 * what the reviewer saw in the diff preview.
 */
export function applyHunks(fullText: string, hunks: LineDiffHunk[]): string {
  const lines = fullText.split('\n')
  const out: string[] = []
  let cursor = 0
  for (const h of hunks) {
    out.push(...lines.slice(cursor, h.startLine))
    out.push(...h.inserted)
    cursor = h.startLine + h.removedCount
  }
  out.push(...lines.slice(cursor))
  return out.join('\n')
}

/**
 * Runs `ruby -c` on Ruby content, returning the syntax error message on failure.
 * Fails open (null) when ruby isn't installed, so a missing runtime never blocks fixes.
 */
function rubySyntaxError(content: string): Promise<string | null> {
  return new Promise(resolve => {
    const child = spawn('ruby', ['-c'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let err = ''
    child.stderr.on('data', d => { err += String(d) })
    child.on('error', () => resolve(null))
    child.on('close', code => resolve(code === 0 ? null : err.trim() || 'unknown syntax error'))
    child.stdin.end(content)
  })
}

function applyCachedDiff(fullText: string, diff: string): string | null {
  const hunks = parseUnifiedDiff(diff)
  if (!hunks) { return null }
  const result = applyUnifiedHunks(fullText, hunks)
  return result.ok ? result.text : null
}

/**
 * Extracts a RuboCop cop name from a diagnostic message. RuboCop diagnostics are
 * `"<message> (<Cop/Name>)"` (RailsForge) or `"<Cop/Name>: <message>"` (direct);
 * RailsForge principle diagnostics carry no cop and return null (unverifiable).
 */
function copNameFromMessage(message: string): string | null {
  const paren = /\(([A-Z][A-Za-z0-9/]+)\)\s*$/.exec(message)
  if (paren) {return paren[1]}
  const prefix = /^([A-Z][A-Za-z0-9/]+):/.exec(message)
  return prefix ? prefix[1] : null
}

type OffenseVerification =
  | { status: 'clean' }
  | { status: 'skipped'; reason: string }
  | { status: 'remaining'; offense: string }

/** Generates a meaningful one-line documentation comment for a class/module. */
function buildDocComment(className: string, headerLine: string): string {
  const isModule = headerLine.trim().startsWith('module')
  const isController = /Controller\b/.test(className)
  const isModel = /< ApplicationRecord\b/.test(headerLine)
  const isMailer = /< ActionMailer::Base\b/.test(headerLine)
  const isJob = /< ApplicationJob\b/.test(headerLine)
  const isChannel = /< ApplicationCable::Channel\b/.test(headerLine)
  const isHelper = /Helper\b/.test(className) && !isController
  const isService = /Service\b/.test(className)
  const isQuery = /Query\b/.test(className)
  const isPolicy = /Policy\b/.test(className)
  const isSerializer = /Serializer\b/.test(className)
  const isDecorator = /Decorator\b/.test(className)
  const isForm = /Form\b/.test(className)

  if (isModule) {
    return `${className} module.`
  }
  if (isController) {
    return 'Base API controller for the application.' // ApplicationController
  }
  if (isModel) {
    return 'ActiveRecord model representing a domain entity.'
  }
  if (isMailer) {
    return 'Application mailer for sending emails.'
  }
  if (isJob) {
    return 'Background job for asynchronous processing.'
  }
  if (isChannel) {
    return 'ActionCable channel for real-time features.'
  }
  if (isHelper) {
    return 'View helper methods for templates.'
  }
  if (isService) {
    return 'Service object encapsulating business logic.'
  }
  if (isQuery) {
    return 'Query object encapsulating database queries.'
  }
  if (isPolicy) {
    return 'Authorization policy for access control.'
  }
  if (isSerializer) {
    return 'Serializer for API response formatting.'
  }
  if (isDecorator) {
    return 'Decorator for presentation logic.'
  }
  if (isForm) {
    return 'Form object for parameter validation and processing.'
  }
  return isModule ? `${className} module.` : `${className} class.`
}

/**
 * Extracts the reported line number from a `ruby -c` error (e.g. "-:11: syntax
 * error, unexpected `end'") and returns the proposed file's lines around it, so
 * the model's retry can see exactly what it produced instead of a bare message.
 */
function syntaxErrorContext(error: string, content: string): string {
  const match = /(?:^|\s)(\d+):\s/.exec(error)
  if (!match) {return ''}
  const errLine = Number(match[1])
  if (!Number.isInteger(errLine) || errLine < 1) {return ''}
  const lines = content.split('\n')
  if (errLine > lines.length) {return ''}
  const from = Math.max(0, errLine - 3)
  const to = Math.min(lines.length, errLine + 2)
  return `\nThe lines around the error in your proposed file:\n${lines.slice(from, to).map((l, i) => `${from + i + 1}: ${l}`).join('\n')}`
}

/** Runs rubocop `--only <cop>` on proposed content and reports whether the offense is gone. */
async function verifyOffenseResolved(
  cop: string,
  rubocop: RuboCopProvider,
  filePath: string,
  content: string,
): Promise<OffenseVerification> {
  const offenses = await rubocop.offensesForCop(cop, filePath, content)
  if (offenses === null) {
    return { status: 'skipped', reason: `rubocop unavailable (could not verify ${cop})` }
  }
  if (offenses.length === 0) {return { status: 'clean' }}
  const first = offenses[0]
  return { status: 'remaining', offense: `${first.message} (${cop}) at line ${first.location.start_line}` }
}

function watchProjectFiles(
  context: vscode.ExtensionContext,
  getRoot: () => string,
  schemaIndexer: SchemaIndexer,
  routesIndexer: RoutesIndexer,
  migrationDiagnostics: MigrationDiagnostics,
  onIndexChanged?: (root: string, kind: 'schema' | 'routes') => void,
): void {
  // Only react to files inside the workspace root this indexer set was built for
  // (a multi-root window delivers events for every folder).
  const inRoot = (uri: vscode.Uri): boolean => isInside(getRoot(), uri.fsPath)

  if (readConfig().schemaAutoIndex) {
    const schemaWatcher = vscode.workspace.createFileSystemWatcher('**/db/schema.rb')
    const refresh = (uri: vscode.Uri): void => {
      if (!inRoot(uri) || isExcludedByConfig(uri.fsPath)) {return}
      void loadSchema(getRoot(), schemaIndexer).then(() => onIndexChanged?.(getRoot(), 'schema'))
    }
    schemaWatcher.onDidChange(refresh)
    schemaWatcher.onDidCreate(refresh)
    schemaWatcher.onDidDelete(uri => {
      if (!inRoot(uri)) {return}
      schemaIndexer.parseSchema('')
      onIndexChanged?.(getRoot(), 'schema')
    })
    context.subscriptions.push(schemaWatcher)
  }

  if (readConfig().routesAutoIndex) {
    const routesWatcher = vscode.workspace.createFileSystemWatcher('**/config/routes.rb')
    const refresh = (uri: vscode.Uri): void => {
      if (!inRoot(uri) || isExcludedByConfig(uri.fsPath)) {return}
      void loadRoutes(getRoot(), routesIndexer).then(() => onIndexChanged?.(getRoot(), 'routes'))
    }
    routesWatcher.onDidChange(refresh)
    routesWatcher.onDidCreate(refresh)
    routesWatcher.onDidDelete(uri => {
      if (!inRoot(uri)) {return}
      routesIndexer.parseRoutesDsl('')
      onIndexChanged?.(getRoot(), 'routes')
    })
    context.subscriptions.push(routesWatcher)
  }

  const migrationWatcher = vscode.workspace.createFileSystemWatcher('**/db/migrate/*.rb')
  const analyzeMigration = (uri: vscode.Uri): void => {
    if (!inRoot(uri) || isExcludedByConfig(uri.fsPath)) {return}
    void vscode.workspace.openTextDocument(uri).then(doc => migrationDiagnostics.updateDiagnostics(doc), () => undefined)
  }
  migrationWatcher.onDidChange(analyzeMigration)
  migrationWatcher.onDidCreate(analyzeMigration)
  migrationWatcher.onDidDelete(uri => migrationDiagnostics.clearFile(uri))
  context.subscriptions.push(migrationWatcher)
}

function registerCommands(
  context: vscode.ExtensionContext,
  mvc: MVCNavigator,
  routes: RoutesIndexer,
  rubocop: RuboCopProvider,
  brakeman: BrakemanProvider,
  bundlerAuditScanner: BundlerAuditScanner,
  strongMigrationsAnalyzer: StrongMigrationsAnalyzer,
  policyNavigator: PolicyNavigator,
  viewComponentResolver: ViewComponentResolver,
  _turboFrameNavigator: TurboFrameNavigator,
  refactoringMenu: RefactoringMenuProvider,
  patternDiagnostics: PatternDiagnosticsProvider,
  serviceExtractor: ServiceExtractor,
  queryExtractor: QueryExtractor,
  projectPatternIndexer: ProjectPatternIndexer,
  agent: RailsAgent,
  principleLinter: DesignPrincipleLinter,
  relatedFilesIndex: RelatedFilesIndex,
  dependencyGraph: MinimalDependencyGraph,
  persistentIndexes: PersistentIndexRegistry<PersistentIndexManager>,
  analyzers: RubyAnalyzersProvider,
  schemaIndexer: SchemaIndexer,
  env: ProjectEnvironment,
  semanticSearchIndex: SemanticSearchIndex,
  rubyDocProvider: RubyDocProvider,
  devDocsProjects: PerRootRegistry<DevDocsProject>,
  speculativeFixCache: SpeculativeFixCache,
  rakeTaskTreeProvider: RakeTaskTreeProvider,
  rbsIndexes: PerRootRegistry<RBSIndex>,
  steepProvider: SteepProvider,
  steepDiagnostics: vscode.DiagnosticCollection,
  getAgentConfig: (cfg?: RailsForgeConfig) => RailsAgentConfig,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('railsforge.optimizeWorkspacePerformance', async () => {
      await optimizeRailsWorkspace()
      void vscode.window.showInformationMessage('RailsForge: Workspace performance settings (file watcher and search exclusions) applied successfully.')
    }),
    vscode.commands.registerCommand('railsforge.showDependencyCycles', async () => {
      const manager = requireAstIndex(persistentIndexes)
      if (!manager) {return}
      const cycles = manager.dependencyGraph.findCycles()
      if (cycles.length === 0) {
        vscode.window.showInformationMessage('RailsForge: No circular dependencies found among indexed services/queries/policies.')
        return
      }
      const lines = cycles.map((cycle, i) => `${i + 1}. ${cycle.join(' → ')}`)
      const doc = await vscode.workspace.openTextDocument({
        content: `# RailsForge: Circular Dependencies\n\n${lines.join('\n')}\n`,
        language: 'markdown',
      })
      await vscode.window.showTextDocument(doc)
    }),
    vscode.commands.registerCommand('railsforge.findDuplicateMethods', async () => {
      const manager = requireAstIndex(persistentIndexes)
      if (!manager) {return}
      const duplicates = manager.duplicateDetector.findDuplicates()
      if (duplicates.length === 0) {
        vscode.window.showInformationMessage('RailsForge: No near-duplicate methods found.')
        return
      }
      const items = duplicates.map(d => ({
        label: `${Math.round(d.similarity * 100)}% similar: ${d.a.name} ↔ ${d.b.name}`,
        description: `${vscode.workspace.asRelativePath(d.a.filePath)}:${d.a.startLine} ↔ ${vscode.workspace.asRelativePath(d.b.filePath)}:${d.b.startLine}`,
        pair: d,
      }))
      const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Near-duplicate methods (consider extracting a shared concern/method)' })
      if (!selected) {return}

      const doc = await vscode.workspace.openTextDocument(selected.pair.a.filePath)
      const editor = await vscode.window.showTextDocument(doc)
      const pos = new vscode.Position(Math.max(0, selected.pair.a.startLine - 1), 0)
      editor.selection = new vscode.Selection(pos, pos)
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
    }),
    vscode.commands.registerCommand('railsforge.setAiApiKey', async () => {
      let provider = readConfig().aiProvider
      if (provider === 'ollama' || provider === 'vscode-lm') {
        const choice = await vscode.window.showQuickPick(
          [
            { label: '$(cloud) OpenAI / Compatible', description: 'OpenAI, OpenRouter, MiniMax, Groq, DeepSeek', provider: 'openai' as const },
            { label: '$(cloud) Anthropic', description: 'Claude Sonnet / Opus', provider: 'anthropic' as const },
          ],
          { placeHolder: 'Select the cloud provider to set an API key for' },
        )
        if (!choice) {return}
        provider = choice.provider
      }

      const providerLabel = provider === 'openai' ? 'OpenAI / Compatible' : 'Anthropic'
      const key = await vscode.window.showInputBox({
        title: `RailsForge: Set ${providerLabel} API Key`,
        prompt: 'Stored securely via VS Code SecretStorage, never written to settings.json. Leave blank and press Enter to clear the stored key.',
        password: true,
        ignoreFocusOut: true,
      })
      if (key === undefined) {return}

      if (key.length === 0) {
        await context.secrets.delete(aiApiKeySecretKey(provider))
        vscode.window.showInformationMessage(`RailsForge: Cleared the stored ${providerLabel} API key.`)
        return
      }

      await context.secrets.store(aiApiKeySecretKey(provider), key)
      agent.updateConfig(getAgentConfig())
      vscode.window.showInformationMessage(`RailsForge: ${providerLabel} API key saved securely.`)
    }),
    vscode.commands.registerCommand('railsforge.generateApiDocs', async () => {
      const root = activeWorkspaceRoot()
      if (!root) {
        vscode.window.showWarningMessage('RailsForge: No workspace folder open.')
        return
      }
      if (!readConfig().apiDocsEnabled) {
        vscode.window.showWarningMessage('RailsForge: railsForge.apiDocs.enabled is false.')
        return
      }

      const allRoutes = routes.getAllRoutes()
      if (allRoutes.length === 0) {
        vscode.window.showWarningMessage('RailsForge: No routes indexed — open a project with config/routes.rb first.')
        return
      }

      const yaml = buildOpenApiSkeleton(allRoutes, { title: path.basename(root) })
      const doc = await vscode.workspace.openTextDocument({ content: yaml, language: 'yaml' })
      await vscode.window.showTextDocument(doc)
      vscode.window.showInformationMessage(
        `RailsForge: Generated an OpenAPI skeleton for ${allRoutes.length} route(s). Response bodies are left as TODOs — RailsForge only knows the route, not your serializers.`,
      )
    }),
    vscode.commands.registerCommand('railsforge.bumpGemVersion', async () => {
      const root = activeWorkspaceRoot()
      if (!root) {
        vscode.window.showWarningMessage('RailsForge: No workspace folder open.')
        return
      }

      const versionFiles = await vscode.workspace.findFiles('lib/**/version.rb', resolveExcludeGlob())
      if (versionFiles.length === 0) {
        vscode.window.showWarningMessage('RailsForge: No lib/**/version.rb found.')
        return
      }

      let targetUri = versionFiles[0]
      if (versionFiles.length > 1) {
        const picked = await vscode.window.showQuickPick(
          versionFiles.map(uri => ({ label: vscode.workspace.asRelativePath(uri), uri })),
          { placeHolder: 'Multiple version.rb files found — pick one' },
        )
        if (!picked) {return}
        targetUri = picked.uri
      }

      const content = fs.readFileSync(targetUri.fsPath, 'utf8')
      const currentVersion = parseVersion(content)
      if (!currentVersion) {
        vscode.window.showWarningMessage(`RailsForge: Couldn't find a VERSION assignment in ${vscode.workspace.asRelativePath(targetUri)}.`)
        return
      }

      const choice = await vscode.window.showQuickPick(
        (['patch', 'minor', 'major'] as VersionBumpPart[]).map(part => ({
          label: `${part} → ${bumpVersion(currentVersion, part)}`,
          part,
        })),
        { placeHolder: `Current version: ${currentVersion}` },
      )
      if (!choice) {return}

      const newVersion = bumpVersion(currentVersion, choice.part)
      fs.writeFileSync(targetUri.fsPath, replaceVersionInContent(content, newVersion), 'utf8')

      const doc = await vscode.workspace.openTextDocument(targetUri)
      await vscode.window.showTextDocument(doc)
      vscode.window.showInformationMessage(`RailsForge: Bumped version to ${newVersion} in ${vscode.workspace.asRelativePath(targetUri)}.`)
    }),
    vscode.commands.registerCommand('railsforge.releaseGem', async () => {
      const root = activeWorkspaceRoot()
      if (!root) {
        vscode.window.showWarningMessage('RailsForge: No workspace folder open.')
        return
      }

      const choice = await vscode.window.showWarningMessage(
        'This runs "rake release" (through your project\'s Ruby toolchain), which builds the gem, creates and pushes a git tag, and publishes it to RubyGems.org. This cannot be undone. Continue?',
        { modal: true },
        'Run rake release',
      )
      if (choice !== 'Run rake release') {return}

      const term = vscode.window.createTerminal({ name: 'RailsForge Release', cwd: root })
      term.show()
      term.sendText(rubyTerminalCommand(root, 'rake', ['release'], currentShellKind()))
    }),
    vscode.commands.registerCommand('railsforge.showLogs', () => {
      Logger.show()
    }),
    vscode.commands.registerCommand('railsforge.exportCursorRules', async () => {
      const root = activeWorkspaceRoot()
      if (!root) {
        vscode.window.showWarningMessage('RailsForge: No workspace folder open.')
        return
      }

      const mcpEnabled = readConfig().mcpEnabled
      const mcpServerPath = path.join(context.extensionPath, 'dist', 'mcp', 'server.js')
      const mcpServerAvailable = mcpEnabled && fs.existsSync(mcpServerPath)

      const content = buildCursorRulesContent({
        rubyVersion: env.rubyVersion,
        railsVersion: env.hasRails ? env.railsVersion : undefined,
        hasRails: env.hasRails,
        projectType: env.projectType,
        tables: schemaIndexer.getAllTables(),
        routes: routes.getAllRoutes(),
        patterns: projectPatternIndexer.getAllPatterns(),
        mcpServerAvailable,
      })

      const rulesDir = path.join(root, '.cursor', 'rules')
      fs.mkdirSync(rulesDir, { recursive: true })
      fs.writeFileSync(path.join(rulesDir, 'railsforge.mdc'), content, 'utf8')

      if (mcpServerAvailable) {
        registerMcpServer(root, mcpServerPath)
      }

      const doc = await vscode.workspace.openTextDocument(path.join(rulesDir, 'railsforge.mdc'))
      await vscode.window.showTextDocument(doc)
      vscode.window.showInformationMessage(
        mcpServerAvailable
          ? 'RailsForge: Exported .cursor/rules/railsforge.mdc and registered the railsforge MCP server in .cursor/mcp.json.'
          : mcpEnabled
            ? 'RailsForge: Exported .cursor/rules/railsforge.mdc. (MCP server not bundled in this build — skipped registration.)'
            : 'RailsForge: Exported .cursor/rules/railsforge.mdc. (railsForge.mcp.enabled is false — skipped MCP server registration.)',
      )
    }),
    vscode.commands.registerCommand('railsforge.copySystemPrompt', async () => {
      const content = buildSystemPromptMarkdown({
        rubyVersion: env.rubyVersion,
        railsVersion: env.hasRails ? env.railsVersion : undefined,
        hasRails: env.hasRails,
        projectType: env.projectType,
        tables: schemaIndexer.getAllTables(),
        routes: routes.getAllRoutes(),
        patterns: projectPatternIndexer.getAllPatterns(),
        mcpServerAvailable: false,
      })
      await vscode.env.clipboard.writeText(content)
      vscode.window.showInformationMessage(
        'RailsForge: System prompt copied to clipboard. Paste it into Cline / Continue / Claude Dev system prompt settings.',
        'View'
      ).then(choice => {
        if (choice !== 'View') { return }
        void vscode.workspace.openTextDocument({ content, language: 'markdown' })
          .then(doc => vscode.window.showTextDocument(doc))
      })
    }),
    vscode.commands.registerCommand('railsforge.applyAiFix', async (uri: vscode.Uri, range: vscode.Range, diagnosticMessage: string) => {
      const document = await vscode.workspace.openTextDocument(uri)
      const targetRange = range.isEmpty ? document.lineAt(range.start.line).range : range
      const code = document.getText(targetRange)
      const fullText = document.getText()
      Logger.info(`[AI Fix] Requesting fix for: "${diagnosticMessage}" in ${vscode.workspace.asRelativePath(uri)}:${targetRange.start.line + 1}`)

      // Snapshot the document version at the start so we can detect
      // concurrent edits that would invalidate our proposed text.
      const docVersionAtStart = document.version

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'RailsForge AI: Generating fix…' },
        async () => {
          // Review-first: shows the exact change in VS Code's diff editor; nothing
          // is written to the file until the developer explicitly accepts it.
          // IMPORTANT: `proposed` was computed against `fullText` (captured above).
          // Before applying, we re-read the document and re-diff so the edit
          // range always matches the *current* buffer — even if the user made
          // edits while reviewing the diff preview.
          const reviewAndApply = async (proposed: string, note: string): Promise<void> => {
            if (proposed === fullText) {
              vscode.window.showInformationMessage('RailsForge: AI fix produced no changes.')
              return
            }
            const proposedDoc = await vscode.workspace.openTextDocument({ content: proposed, language: document.languageId })
            await vscode.commands.executeCommand('vscode.diff', uri, proposedDoc.uri, `RailsForge AI Fix: ${diagnosticMessage}`)

            const choice = await vscode.window.showInformationMessage(
              `RailsForge AI: review the diff, then confirm.${note}`,
              'Apply Fix',
              'Discard',
            )
            void vscode.commands.executeCommand('workbench.action.closeActiveEditor')

            if (choice !== 'Apply Fix') {
              vscode.window.showInformationMessage('RailsForge: AI fix discarded.')
              return
            }

            // Re-read the document NOW — the user may have edited it while
            // reviewing the diff preview. Re-diff against the current buffer
            // so the WorkspaceEdit range is always valid.
            const currentText = document.getText()
            let finalProposed = proposed
            if (currentText !== fullText) {
              Logger.info(`[AI Fix] Document changed during review (v${docVersionAtStart} → v${document.version}), re-diffing against current buffer`)
              const hunks = diffLines(fullText, proposed)
              const { keep } = filterFixHunks(hunks, { startLine: targetRange.start.line, endLine: targetRange.end.line })
              if (keep.length > 0) {
                finalProposed = applyHunks(currentText, keep)
              } else {
                // Hunks fell outside the range after the document shifted;
                // fall back to a full-file diff against the current buffer.
                const freshHunks = diffLines(currentText, proposed)
                finalProposed = applyHunks(currentText, freshHunks)
              }
            }

            const edit = new vscode.WorkspaceEdit()
            edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(currentText.length)), finalProposed)
            const applied = await vscode.workspace.applyEdit(edit)
            if (!applied) {
              Logger.error(`[AI Fix] workspace.applyEdit returned false for ${vscode.workspace.asRelativePath(uri)}`)
              vscode.window.showErrorMessage('RailsForge: Failed to apply the edit — the file may have been modified. Please try again.')
              return
            }

            const editor = vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()
              ? vscode.window.activeTextEditor
              : await vscode.window.showTextDocument(document)

            const appliedRange = new vscode.Range(
              targetRange.start,
              new vscode.Position(targetRange.start.line + finalProposed.split('\n').length - 1, 0),
            )
            editor.selection = new vscode.Selection(targetRange.start, targetRange.end)
            editor.revealRange(appliedRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
            vscode.window.showInformationMessage(`RailsForge AI: Fix applied for "${diagnosticMessage}".`)
          }

          // Turns a proposal into full proposed text (or null when it can't be
          // applied). Patch proposals apply verified hunks; snippet proposals are
          // diffed against the buffer and filtered to the reported problem so
          // unrelated model edits (reformatting, whole-file rewrites) are suppressed.
          const applyProposal = async (proposal: AiFixProposal): Promise<{ text: string; note: string } | { error: string } | null> => {
            if (proposal.type === 'patch') {
              // Apply hunks for this file only; hunks for other files (multi-file
              // fixes) are reported and skipped.
              const docRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? path.dirname(document.uri.fsPath)
              const relevant = proposal.hunks.filter(h => h.file === null || patchFileMatches(h.file, document.uri.fsPath, docRoot))
              if (relevant.length === 0) {
                vscode.window.showInformationMessage('RailsForge: AI fix only targeted other files — nothing applied to this one.')
                return null
              }
              const result = applyUnifiedHunks(fullText, relevant)
              if (!result.ok) {
                // The hunk no longer matches the buffer (stale line numbers or
                // drifted context). Feed the failure — with the actual lines
                // around the declared position — back so the model can emit a
                // corrected diff, mirroring the syntax-error retry.
                const start = Math.max(0, result.hunkLine - 2)
                const actual = fullText.split('\n')
                  .slice(start, result.hunkLine + 3)
                  .map((l, i) => `${start + i + 1}: ${l}`)
                  .join('\n')
                return { error: `${result.reason}. Actual lines around there:\n${actual}` }
              }
              const note = relevant.length !== proposal.hunks.length
                ? ` (${proposal.hunks.length - relevant.length} hunk(s) for other files skipped)`
                : ''
              return { text: result.text, note }
            }

            const fixed = proposal.code
            const topLevelDecls = (s: string): number => (s.match(/^\s*(?:class|module)\s+[A-Z]/gm) ?? []).length
            const isFullFileRewrite = topLevelDecls(fixed) > topLevelDecls(code) || fixed.split('\n').length > code.split('\n').length + 3

            const allHunks = isFullFileRewrite
              ? diffLines(fullText, fixed)
              : diffLines(fullText, fullText.slice(0, document.offsetAt(targetRange.start)) + fixed + fullText.slice(document.offsetAt(targetRange.end)))
            const { keep: hunks, skipped } = filterFixHunks(allHunks, { startLine: targetRange.start.line, endLine: targetRange.end.line })

            if (hunks.length === 0) {
              if (skipped > 0) {
                vscode.window.showWarningMessage(`RailsForge: AI fix only changed ${skipped} unrelated area(s) outside the reported issue — nothing applied.`)
              } else {
                vscode.window.showInformationMessage('RailsForge: AI fix produced no changes.')
              }
              return null
            }

            const changedLines = hunks.reduce((sum, h) => sum + h.removedCount + h.inserted.length, 0)
            if (changedLines > Math.max(50, fullText.split('\n').length / 2)) {
              Logger.warn(`[AI Fix] Rejected: diff touches ${changedLines} lines — likely a hallucinated rewrite`)
              vscode.window.showWarningMessage('RailsForge: AI fix rejected — it would change too much of the file.')
              return null
            }

            const note = skipped > 0 ? ` (${skipped} unrelated model change(s) skipped)` : ''
            return { text: applyHunks(fullText, hunks), note }
          }

          // Agentic verify loop: propose → apply in-memory → check Ruby syntax →
          // re-run rubocop for the reported cop → feed remaining offense back.
          // Each failure mode retries while the attempt budget lasts; a repeated
          // proposal (no progress) short-circuits so we don't burn the budget.
          const cop = copNameFromMessage(diagnosticMessage)

          // Deterministic fix for common offenses — bypass the model entirely for
          // patterns we can fix programmatically. Currently: Style/Documentation on
          // a single-line class/module header (adds a meaningful one-line comment above it).
          let deterministicFix: string | null = null
          if (cop === 'Style/Documentation' && targetRange.start.line === targetRange.end.line) {
            const headerLine = fullText.split('\n')[targetRange.start.line]
            if (/^\s*(?:class|module)\s+[A-Z]/.test(headerLine.trim())) {
              const lines = fullText.split('\n')
              const indent = headerLine.match(/^\s*/)?.[0] ?? ''
              const className = headerLine.match(/(?:class|module)\s+([A-Z]\w*)/)?.[1] ?? 'Product'
              const comment = `${indent}# ${buildDocComment(className, headerLine)}`
              lines.splice(targetRange.start.line, 0, comment)
              deterministicFix = lines.join('\n')
              Logger.debug(`[AI Fix] Applied deterministic fix for ${cop}`)
            }
          }

          if (deterministicFix) {
            const syntaxErr = await rubySyntaxError(deterministicFix)
            if (!syntaxErr) {
              const verification = await verifyOffenseResolved(cop!, rubocop, document.fileName, deterministicFix)
              if (verification.status === 'clean' || verification.status === 'skipped') {
                // Re-read document to guard against concurrent edits during syntax/verification checks
                const currentFullText = document.getText()
                const edit = new vscode.WorkspaceEdit()
                edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(currentFullText.length)), deterministicFix)
                const applied = await vscode.workspace.applyEdit(edit)
                if (!applied) {
                  Logger.error('[AI Fix] Deterministic fix: workspace.applyEdit returned false')
                  vscode.window.showErrorMessage('RailsForge: Failed to apply deterministic fix — the file may have been modified. Please try again.')
                  return
                }
                vscode.window.showInformationMessage(`RailsForge: Deterministic fix applied for "${diagnosticMessage}".`)
                return
              }
            }
          }

          // Speculative cache: check for pre-generated fix for this cop + code pattern
          const cachedDiff = cop ? speculativeFixCache.get(cop, code) : null
          if (cachedDiff) {
            // Re-read the document to get the latest buffer (avoid stale shadow)
            const cachedFullText = document.getText()
            const appliedText = applyCachedDiff(cachedFullText, cachedDiff)
            if (appliedText && appliedText !== cachedFullText) {
              const syntaxErr = await rubySyntaxError(appliedText)
              if (!syntaxErr) {
                const verification = await verifyOffenseResolved(cop!, rubocop, document.fileName, appliedText)
                if (verification.status === 'clean' || verification.status === 'skipped') {
                  const edit = new vscode.WorkspaceEdit()
                  edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(cachedFullText.length)), appliedText)
                  const applied = await vscode.workspace.applyEdit(edit)
                  if (!applied) {
                    Logger.error('[AI Fix] Cached fix: workspace.applyEdit returned false')
                    vscode.window.showErrorMessage('RailsForge: Failed to apply cached fix — the file may have been modified. Please try again.')
                    return
                  }
                  vscode.window.showInformationMessage(`RailsForge: Cached fix applied instantly for "${diagnosticMessage}".`)
                  return
                }
              }
            }
          }

          const MAX_FIX_ATTEMPTS = 4
          let feedback: string | undefined
          let lastText: string | null = null
          let lastRejection: string | null = null

          for (let attempt = 0; attempt < MAX_FIX_ATTEMPTS; attempt++) {
            const proposal = await agent.suggestFix(code, diagnosticMessage, {
              fileName: document.fileName,
              fileContent: document.getText(),
              selection: code,
              workspaceRoot: activeWorkspaceRoot(),
            }, feedback)

            if (!proposal) {
              Logger.warn(`[AI Fix] Fix unavailable for: "${diagnosticMessage}"`)
              vscode.window.showWarningMessage('RailsForge: AI fix unavailable (check that Ollama is running or AI provider key is set).')
              return
            }

            const applied = await applyProposal(proposal)
            if (!applied) {return}

            if ('error' in applied) {
              Logger.warn(`[AI Fix] Retrying: ${applied.error}`)
              feedback = applied.error
              lastRejection = applied.error
              continue
            }

            if (applied.text === lastText) {
              Logger.warn('[AI Fix] Rejected: model repeated the same fix without making progress')
              vscode.window.showWarningMessage('RailsForge: AI fix stopped — the model repeated the same fix.')
              return
            }
            lastText = applied.text

            const syntaxErr = await rubySyntaxError(applied.text)
            if (syntaxErr) {
              Logger.warn(`[AI Fix] Retrying: proposal produced invalid Ruby syntax: ${syntaxErr}`)
              feedback = `Your fix would produce invalid Ruby syntax:\n${syntaxErr}${syntaxErrorContext(syntaxErr, applied.text)}`
              lastRejection = `the fix would produce invalid Ruby syntax: ${syntaxErr}`
              continue
            }

            if (!cop) {
              // Principle-linter diagnostics carry no cop, so there's nothing to
              // verify — offer the syntax-checked fix as before.
              await reviewAndApply(applied.text, applied.note)
              return
            }

            const verification = await verifyOffenseResolved(cop, rubocop, document.fileName, applied.text)
            if (verification.status === 'clean') {
              Logger.debug(`[AI Fix] Verified: ${cop} no longer reported (attempt ${attempt + 1})`)
              await reviewAndApply(applied.text, applied.note)
              return
            }
            if (verification.status === 'skipped') {
              Logger.warn(`[AI Fix] ${verification.reason} — offering fix without verification`)
              await reviewAndApply(applied.text, applied.note)
              return
            }
            Logger.debug(`[AI Fix] Offense remains after attempt ${attempt + 1}: ${verification.offense}`)
            feedback = `RuboCop still reports the offense in the proposed file: ${verification.offense}. Your fix must resolve this exact offense — do not just reformat or add a rubocop:disable comment.`
          }

          Logger.warn(`[AI Fix] Rejected after ${MAX_FIX_ATTEMPTS} attempts: ${lastRejection ?? 'reported offense still present'}`)
          vscode.window.showWarningMessage(`RailsForge: AI fix could not be resolved — ${lastRejection ?? 'RuboCop still reports the issue'}.`)
        },
      )
    }),
    vscode.commands.registerCommand('railsforge.fixAllInFile', async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri
      if (!targetUri) {return}
      const document = await vscode.workspace.openTextDocument(targetUri)
      const diagnostics = vscode.languages.getDiagnostics(targetUri).filter(d => d.source === 'RailsForge Principles')

      let applied = 0
      let failed = 0
      for (const diag of diagnostics) {
        const codeActionContext: vscode.CodeActionContext = { diagnostics: [diag], only: undefined, triggerKind: vscode.CodeActionTriggerKind.Invoke }
        const actions = principleLinter.provideCodeActions(document, diag.range, codeActionContext)
        const deterministic = actions.find(a => a.edit && !a.command)
        if (deterministic?.edit) {
          const ok = await vscode.workspace.applyEdit(deterministic.edit)
          if (ok) { applied++ } else { failed++ }
        }
      }
      if (failed > 0) {
        vscode.window.showWarningMessage(`RailsForge: Applied ${applied} fix(es), ${failed} failed — the file may have been modified during batch application.`)
      } else {
        vscode.window.showInformationMessage(`RailsForge: Applied ${applied} deterministic fix(es). AI fixes must be applied individually via the lightbulb.`)
      }
    }),
    vscode.commands.registerCommand('railsforge.showSimilarPatterns', async (filePath: string, line: number) => {
      const pattern = projectPatternIndexer.findPatternAt(filePath, line)
      if (!pattern) {
        vscode.window.showWarningMessage('RailsForge: No indexed pattern found at this location.')
        return
      }
      const similar = projectPatternIndexer.findSimilar(pattern)
      if (similar.length === 0) {
        vscode.window.showInformationMessage(`No similar ${pattern.type}s found elsewhere in this project.`)
        return
      }
      const items = similar.map(p => ({
        label: p.name,
        description: vscode.workspace.asRelativePath(p.filePath),
        detail: p.publicMethods.length > 0 ? `Public methods: ${p.publicMethods.join(', ')}` : undefined,
        pattern: p,
      }))
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Similar ${pattern.type}s to ${pattern.name} already in this project`,
        matchOnDescription: true,
        matchOnDetail: true,
      })
      if (selected) {
        const doc = await vscode.workspace.openTextDocument(selected.pattern.filePath)
        const editor = await vscode.window.showTextDocument(doc)
        const pos = new vscode.Position(Math.max(0, selected.pattern.lineStart - 1), 0)
        editor.selection = new vscode.Selection(pos, pos)
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
      }
    }),
    vscode.commands.registerCommand('railsforge.showRelatedFiles', async (name: string) => {
      const items: Array<{ label: string; description: string; filePath: string; line?: number }> = []

      const relations = await relatedFilesIndex.getModelRelations(name)
      for (const [type, list] of Object.entries(relations.patternsByType)) {
        for (const p of list ?? []) {
          items.push({ label: `$(symbol-class) ${p.name}`, description: type, filePath: p.filePath, line: p.lineStart })
        }
      }

      for (const edge of dependencyGraph.getCollaborators(name)) {
        const collaborator = projectPatternIndexer.getAllPatterns().find(p => p.name === edge.to)
        if (collaborator) {
          items.push({ label: `$(arrow-right) ${edge.to}`, description: 'depends on', filePath: collaborator.filePath, line: collaborator.lineStart })
        }
      }
      for (const edge of dependencyGraph.getCallers(name)) {
        const caller = projectPatternIndexer.getAllPatterns().find(p => p.name === edge.from)
        if (caller) {
          items.push({ label: `$(arrow-left) ${edge.from}`, description: 'called by', filePath: caller.filePath, line: caller.lineStart })
        }
      }
      for (const specPath of relatedFilesIndex.getSpecFiles(name)) {
        items.push({ label: `$(beaker) ${vscode.workspace.asRelativePath(specPath)}`, description: 'spec', filePath: specPath })
      }

      if (items.length === 0) {
        vscode.window.showInformationMessage(`RailsForge: No related files indexed for ${name}.`)
        return
      }

      const selected = await vscode.window.showQuickPick(items, { placeHolder: `Files related to ${name}` })
      if (!selected) {return}

      const doc = await vscode.workspace.openTextDocument(selected.filePath)
      const editor = await vscode.window.showTextDocument(doc)
      if (selected.line) {
        const pos = new vscode.Position(Math.max(0, selected.line - 1), 0)
        editor.selection = new vscode.Selection(pos, pos)
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
      }
    }),
    vscode.commands.registerCommand('railsforge.semanticSearch', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'RailsForge Semantic Search — describe what you\'re looking for (e.g. "charge a card", "send a welcome email")',
        placeHolder: 'What are you looking for?',
      })
      if (!query) {return}

      const results = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'RailsForge: Searching…' },
        () => semanticSearchIndex.search(query),
      )

      if (results.length === 0) {
        vscode.window.showInformationMessage(`RailsForge: No matches found for "${query}".`)
        return
      }

      const items = results.map(r => ({
        label: `${r.matchedBy === 'semantic' ? '🧠' : '🔤'} ${r.pattern.name}`,
        description: `${r.pattern.type} · ${vscode.workspace.asRelativePath(r.pattern.filePath)}`,
        detail: r.pattern.preview.split('\n').find(l => l.trim().length > 0)?.trim(),
        result: r,
      }))

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Results for "${query}" (🧠 semantic · 🔤 keyword fallback)`,
        matchOnDescription: true,
        matchOnDetail: true,
      })
      if (!selected) {return}

      const doc = await vscode.workspace.openTextDocument(selected.result.pattern.filePath)
      const editor = await vscode.window.showTextDocument(doc)
      const pos = new vscode.Position(Math.max(0, selected.result.pattern.lineStart - 1), 0)
      editor.selection = new vscode.Selection(pos, pos)
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
    }),
    vscode.commands.registerCommand('railsforge.scanWorkspaceArchitecture', () => {
      patternDiagnostics.scanWorkspace()
      vscode.window.showInformationMessage('🔍 RailsForge: Live workspace architecture & pattern scan completed.')
    }),
    vscode.commands.registerCommand('railsforge.refactorSelection', () => refactoringMenu.promptRefactoring()),
    vscode.commands.registerCommand('railsforge.goToModel', () => navigateCompanion(mvc, 'model')),
    vscode.commands.registerCommand('railsforge.goToController', () => navigateCompanion(mvc, 'controller')),
    vscode.commands.registerCommand('railsforge.goToView', () => navigateToView(mvc)),
    vscode.commands.registerCommand('railsforge.goToSpec', () => navigateCompanion(mvc, 'spec')),
    vscode.commands.registerCommand('railsforge.searchRoutes', async () => {
      const allRoutes = routes.getAllRoutes()
      const items = allRoutes.map(r => ({
        label: `${r.verb} ${r.uriPattern}`,
        description: `${r.controller}#${r.action} (${r.helperName || ''})`,
      }))
      const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Search Rails routes...' })
      if (selected) {
        vscode.window.showInformationMessage(`Selected Route: ${selected.label} => ${selected.description}`)
      }
    }),
    vscode.commands.registerCommand('railsforge.showSchemaPeek', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        vscode.window.showWarningMessage('RailsForge: No active editor.')
        return
      }

      // A PascalCase word under the cursor (e.g. hovering "User" in "belongs_to :user"'s
      // inferred class, or a bare reference elsewhere) wins over the current file, so
      // peeking a *different* model than the one you're editing works too.
      const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active, /[A-Za-z][A-Za-z0-9_]*/)
      const word = wordRange ? editor.document.getText(wordRange) : undefined
      const fileModel = mvc.identifyFileType(editor.document.fileName) === 'model'
        ? mvc.extractResourceInfo(editor.document.fileName)?.singularName
        : undefined
      const modelName = word ?? fileModel

      if (!modelName) {
        vscode.window.showWarningMessage('RailsForge: Place the cursor on a model name (e.g. "User"), or run this from a model file.')
        return
      }

      const columns = schemaIndexer.getModelColumns(modelName)
      if (columns.length === 0) {
        vscode.window.showWarningMessage(`RailsForge: No schema found for "${modelName}" in db/schema.rb.`)
        return
      }

      const lines = [
        `# Schema: ${modelName}`,
        '',
        '| Column | Type | Nullable | Default |',
        '| --- | --- | :---: | --- |',
        ...columns.map(c => `| \`${c.name}\` | \`${c.type}\` | ${c.nullable ? '✓' : '✗'} | ${c.default ? `\`${c.default}\`` : '-'} |`),
      ]
      const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' })
      await vscode.window.showTextDocument(doc, { preview: true })
    }),
    vscode.commands.registerCommand('railsforge.rubocopAutocorrect', async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri
      if (targetUri) {
        const success = await rubocop.autoCorrectFile(targetUri, readConfig().rubocopMode)
        if (success) {
          vscode.window.showInformationMessage('✓ RuboCop autocorrect completed.')
        }
      }
    }),
    vscode.commands.registerCommand('railsforge.runBrakeman', async () => {
      const root = activeWorkspaceRoot()
      if (!root) {return}
      const report = await brakeman.runScan(root)
      const formatted = brakeman.formatMarkdownReport(report)
      const doc = await vscode.workspace.openTextDocument({ content: formatted, language: 'markdown' })
      await vscode.window.showTextDocument(doc)
    }),
    vscode.commands.registerCommand('railsforge.runBundleAudit', async () => {
      const root = activeWorkspaceRoot()
      if (!root) {return}
      const report = await bundlerAuditScanner.runAudit(root)
      const formatted = bundlerAuditScanner.formatReport(report)
      const doc = await vscode.workspace.openTextDocument({ content: formatted, language: 'markdown' })
      await vscode.window.showTextDocument(doc)
    }),
    vscode.commands.registerCommand('railsforge.analyzeMigration', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {return}
      const code = editor.document.getText()
      const dangers = strongMigrationsAnalyzer.analyzeMigration(code)
      if (dangers.length === 0) {
        vscode.window.showInformationMessage('✓ Zero-downtime migration check passed! No dangerous operations found.')
        return
      }
      const summary = dangers.map(d => `[${d.severity.toUpperCase()}] Line ${d.line}: ${d.title}\nFix: ${d.recommendation}`).join('\n\n')
      const doc = await vscode.workspace.openTextDocument({ content: `# RailsForge Strong Migrations Report\n\n${summary}`, language: 'markdown' })
      await vscode.window.showTextDocument(doc)
    }),
    vscode.commands.registerCommand('railsforge.extractService', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {return}
      const selection = editor.document.getText(editor.selection)
      if (!selection) {
        vscode.window.showWarningMessage('Please select code to extract into a Service Object.')
        return
      }
      const name = await vscode.window.showInputBox({ prompt: 'Enter Service Object Name (e.g. ProcessOrder)' })
      if (!name) {return}
      const root = activeWorkspaceRoot() ?? ''
      const freeVars = serviceExtractor.detectFreeVariables(selection)
      const guidelines = loadEffectiveServiceObjectGuidelines(root, projectPatternIndexer)
      const res = serviceExtractor.extractService(name, selection, freeVars, root, guidelines)

      // Single WorkspaceEdit so VS Code shows one multi-file diff preview: only the
      // selected range in the original file changes, plus the new service file — nothing
      // else in the controller/model is touched (unless the developer opts into replacing
      // other exact duplicates of this same selection, below).
      if (fs.existsSync(res.serviceFilePath)) {
        vscode.window.showErrorMessage(`RailsForge: ${path.relative(root, res.serviceFilePath)} already exists — choose a different name. Nothing was changed.`)
        return
      }
      const edit = new vscode.WorkspaceEdit()
      const serviceUri = vscode.Uri.file(res.serviceFilePath)
      edit.createFile(serviceUri, { overwrite: false, ignoreIfExists: false })
      edit.insert(serviceUri, new vscode.Position(0, 0), res.serviceCode)
      edit.replace(editor.document.uri, editor.selection, res.replacementCall)

      await maybeReplaceDuplicateCallSites(edit, selection, res.replacementCall, editor.document.uri)
      maybeGenerateSpec(edit, res.serviceFilePath, root, 'service', res.replacementCall.split('.')[0])

      const applied = await vscode.workspace.applyEdit(edit)
      if (!applied) {
        vscode.window.showErrorMessage('RailsForge: Failed to apply Extract Service edit.')
        return
      }
      const doc = await vscode.workspace.openTextDocument(res.serviceFilePath)
      await vscode.window.showTextDocument(doc)
    }),
    vscode.commands.registerCommand('railsforge.generateServiceObject', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Enter Service Object Name (e.g. ProcessOrder)' })
      if (!name) {return}
      const root = activeWorkspaceRoot() ?? ''
      const guidelines = loadEffectiveServiceObjectGuidelines(root, projectPatternIndexer)
      const res = serviceExtractor.extractService(name, '# TODO: implement', [], root, guidelines)

      if (fs.existsSync(res.serviceFilePath)) {
        vscode.window.showErrorMessage(`RailsForge: ${path.relative(root, res.serviceFilePath)} already exists.`)
        return
      }
      serviceExtractor.saveServiceFile(res.serviceFilePath, res.serviceCode)
      const doc = await vscode.workspace.openTextDocument(res.serviceFilePath)
      await vscode.window.showTextDocument(doc)
    }),
    vscode.commands.registerCommand('railsforge.extractQuery', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {return}
      const selection = editor.document.getText(editor.selection)
      if (!selection) {
        vscode.window.showWarningMessage('Please select an ActiveRecord query to extract.')
        return
      }
      const name = await vscode.window.showInputBox({ prompt: 'Enter Query Object Name (e.g. ActiveUsers)' })
      if (!name) {return}
      const model = await vscode.window.showInputBox({ prompt: 'Enter Base Model Name (e.g. User)' })
      if (!model) {return}
      const root = activeWorkspaceRoot() ?? ''
      const res = queryExtractor.extractQuery(name, model, selection, [], root)

      if (fs.existsSync(res.queryFilePath)) {
        vscode.window.showErrorMessage(`RailsForge: ${path.relative(root, res.queryFilePath)} already exists — choose a different name. Nothing was changed.`)
        return
      }
      const edit = new vscode.WorkspaceEdit()
      const queryUri = vscode.Uri.file(res.queryFilePath)
      edit.createFile(queryUri, { overwrite: false, ignoreIfExists: false })
      edit.insert(queryUri, new vscode.Position(0, 0), res.queryCode)
      edit.replace(editor.document.uri, editor.selection, res.replacementCall)

      await maybeReplaceDuplicateCallSites(edit, selection, res.replacementCall, editor.document.uri)
      maybeGenerateSpec(edit, res.queryFilePath, root, 'query', res.replacementCall.split('.')[0])

      const applied = await vscode.workspace.applyEdit(edit)
      if (!applied) {
        vscode.window.showErrorMessage('RailsForge: Failed to apply Extract Query edit.')
        return
      }
      const doc = await vscode.workspace.openTextDocument(res.queryFilePath)
      await vscode.window.showTextDocument(doc)
    }),
    vscode.commands.registerCommand('railsforge.goToPolicy', () => {
      const editor = vscode.window.activeTextEditor
      const root = activeWorkspaceRoot()
      if (!editor || !root) {return}
      const model = path.basename(editor.document.fileName, '.rb').replace(/(_controller|_spec)$/, '')
      const policyPath = policyNavigator.resolvePolicyPath(model, root)
      if (policyPath) {
        void vscode.workspace.openTextDocument(policyPath).then(doc => vscode.window.showTextDocument(doc))
      } else {
        vscode.window.showWarningMessage(`No policy found for ${model}`)
      }
    }),
    vscode.commands.registerCommand('railsforge.goToComponent', async () => {
      const root = activeWorkspaceRoot()
      if (!root) {return}
      const name = await vscode.window.showInputBox({ prompt: 'Enter Component Name (e.g. UserCardComponent)' })
      if (!name) {return}
      const comp = viewComponentResolver.resolveComponent(name, root)
      if (comp) {
        const doc = await vscode.workspace.openTextDocument(comp.classFile)
        await vscode.window.showTextDocument(doc)
      } else {
        vscode.window.showWarningMessage(`Component ${name} not found in app/components/`)
      }
    }),
    vscode.commands.registerCommand('railsforge.runSingleTest', (uri: vscode.Uri, line: number) => {
      const term = createProjectTerminal('RailsForge Test', uri)
      term.show()
      term.sendText(buildSingleTestCommand(uri, line, env))
    }),
    vscode.commands.registerCommand('railsforge.debugSingleTest', (uri: vscode.Uri, line: number) => {
      const { tool, args } = singleTestInvocation(uri, line, env)
      void debugRubyCommand(uri, tool, args)
    }),
    vscode.commands.registerCommand('railsforge.openDevDocs', () => {
      const editor = vscode.window.activeTextEditor
      const word = editor?.document.getWordRangeAtPosition(editor.selection.active)
      const term = word ? editor?.document.getText(word) : undefined
      const cfg = readConfig()
      DevDocsPanel.createOrShow(cfg.devdocsBaseUrl, cfg.devdocsOpenBesideActiveEditor, term)
    }),
    vscode.commands.registerCommand('railsforge.openRubyDoc', async () => {
      const cfg = readConfig()
      const editor = vscode.window.activeTextEditor
      const symbolRange = editor?.document.getWordRangeAtPosition(editor.selection.active, /[A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*[#.][a-z_][A-Za-z0-9_!?]*|[A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*/)
      const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : undefined
      const symbol = (selected ?? (symbolRange ? editor!.document.getText(symbolRange) : undefined))?.trim()
      if (!symbol) {
        vscode.window.showWarningMessage('RailsForge: Place the cursor on (or select) a class/module name, e.g. "Pundit" or "Sidekiq::Client#push".')
        return
      }

      const root = activeWorkspaceRoot()
      if (!root) {
        vscode.window.showWarningMessage('RailsForge: Open a workspace folder to look up gem documentation.')
        return
      }
      const lockPath = path.join(root, 'Gemfile.lock')
      if (!fs.existsSync(lockPath)) {
        vscode.window.showWarningMessage('RailsForge: No Gemfile.lock found — gem documentation needs an exact locked version.')
        return
      }
      const lockedVersions = parseGemfileLock(fs.readFileSync(lockPath, 'utf8'))
      const resolver = new GemSymbolResolver(lockedVersions, cfg.rubydocNamespaceMappings)

      const [className, methodName] = symbol.split(/[#.]/, 2)
      const resolved = resolver.resolve(className)
      if (!resolved) {
        vscode.window.showWarningMessage(`RailsForge: Could not determine which gem defines "${className}" — check it's in Gemfile.lock, or add a mapping via railsForge.rubydoc.namespaceMappings.`)
        return
      }

      const classPath = className.replace(/::/g, '/')
      const classUrl = `${cfg.rubydocBaseUrl.replace(/\/$/, '')}/gems/${encodeURIComponent(resolved.gem)}/${resolved.version}/${classPath}`

      // "Class#method" / "Class.method" selections get an in-editor markdown preview
      // (signature/params/return, from RubyDocProvider); a bare class name just opens
      // the real page externally — the source of truth for a full class overview.
      if (methodName) {
        const entry = await rubyDocProvider.fetchMethod(resolved.gem, resolved.version, className, methodName)
        if (entry) {
          const doc = await vscode.workspace.openTextDocument({ content: formatRubyDocEntry(entry), language: 'markdown' })
          await vscode.window.showTextDocument(doc, { preview: true })
          return
        }
      }

      await vscode.env.openExternal(vscode.Uri.parse(classUrl))
    }),
    vscode.commands.registerCommand('railsforge.updateDevDocs', async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'RailsForge: Downloading offline DevDocs data…' },
        async () => {
          const root = activeWorkspaceRoot()
          if (!root) {
            vscode.window.showWarningMessage('RailsForge: Open a Ruby project to update its offline DevDocs cache.')
            return
          }
          const project = devDocsProjects.get(root)
          const results = await project.refresh(true)
          if (results.every(Boolean)) {
            vscode.window.showInformationMessage(`RailsForge: Offline DevDocs cache updated (${project.slugs.join(', ')}).`)
          } else {
            vscode.window.showWarningMessage(`RailsForge: Could not download ${project.slugs.filter((_, i) => !results[i]).join(', ')} — check your network connection. Previously cached data (if any) is unchanged.`)
          }
        },
      )
    }),
    vscode.commands.registerCommand('railsforge.showRuntimeIntrospection', async () => {
      const root = activeWorkspaceRoot()
      if (root) {await showRuntimeSnapshot(root, false)}
    }),
    vscode.commands.registerCommand('railsforge.refreshRuntimeIntrospection', async () => {
      const root = activeWorkspaceRoot()
      if (root) {await showRuntimeSnapshot(root, true)}
    }),
    vscode.commands.registerCommand('railsforge.runAnalyzers', () => runCodeAnalyzers(analyzers)),
    vscode.commands.registerCommand('railsforge.clearAnalyzers', () => analyzers.clear()),
    vscode.commands.registerCommand('railsforge.generate', () => runRailsGenerator('generate', rubocop)),
    vscode.commands.registerCommand('railsforge.destroyGenerated', () => runRailsGenerator('destroy', rubocop)),
    vscode.commands.registerCommand('railsforge.runRakeTask', (taskName: string) => {
      if (!taskName) {return}
      const term = createProjectTerminal('RailsForge Rake')
      term.show()
      term.sendText(rubyTerminalCommand(activeWorkspaceRoot() ?? '', 'rake', [taskName], currentShellKind()))
    }),
    vscode.commands.registerCommand('railsforge.refreshRakeTasks', () => {
      rakeTaskTreeProvider.refresh()
    }),
    vscode.commands.registerCommand('railsforge.openRailsConsole', () => {
      const term = createProjectTerminal('RailsForge Console')
      term.show()
      const consoleRoot = activeWorkspaceRoot() ?? ''
      const kind = currentShellKind()
      if (env.hasRails) {
        term.sendText(rubyTerminalCommand(consoleRoot, 'rails', ['console'], kind))
      } else if (env.hasPry) {
        term.sendText(rubyTerminalCommand(consoleRoot, 'pry', [], kind))
      } else {
        const irb = rubyTerminalCommand(consoleRoot, 'irb', [], kind)
        term.sendText(kind === 'powershell' ? irb : `${irb} || irb`)
      }
    }),
    vscode.commands.registerCommand('railsforge.evaluateInREPL', () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        vscode.window.showWarningMessage('RailsForge: No active editor to evaluate a selection from.')
        return
      }
      const code = editor.document.getText(editor.selection.isEmpty ? editor.document.lineAt(editor.selection.active.line).range : editor.selection)
      if (!code.trim()) {return}

      const term = vscode.window.activeTerminal ?? vscode.window.createTerminal('RailsForge Console')
      term.show()
      term.sendText(code, true)
    }),
    vscode.commands.registerCommand('railsforge.applyRubocopStyleGuide', async () => {
      const root = activeWorkspaceRoot()
      if (!root) {
        vscode.window.showWarningMessage('RailsForge: Open a workspace folder first.')
        return
      }

      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(package) Shopify', description: 'rubocop-shopify', guide: 'shopify' as const },
          { label: '$(package) GitLab', description: 'gitlab-styles', guide: 'gitlab' as const },
          { label: '$(package) Airbnb', description: 'rubocop-airbnb', guide: 'airbnb' as const },
        ],
        { placeHolder: 'Apply a community RuboCop style guide' },
      )
      if (!choice) {return}

      const result = applyStyleGuideToWorkspace(root, choice.guide)
      const doc = await vscode.workspace.openTextDocument(path.join(root, '.rubocop.yml'))
      await vscode.window.showTextDocument(doc)

      const gemNote = result.gemAdded ? ' Run `bundle install` to pick up the new gem.' : ''
      vscode.window.showInformationMessage(
        result.ymlChanged || result.gemAdded
          ? `RailsForge: Applied ${getStyleGuideApplication(choice.guide).label}.${gemNote}`
          : `RailsForge: ${getStyleGuideApplication(choice.guide).label} was already applied — nothing changed.`,
      )
    }),
    vscode.commands.registerCommand('railsforge.runSteepCheck', async () => {
      const root = activeWorkspaceRoot()
      if (!root) {return}

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'RailsForge: Running Steep…' },
        async () => {
          const count = await updateSteepDiagnostics(steepProvider, steepDiagnostics, root)
          if (count === 0) {
            vscode.window.showInformationMessage('RailsForge: Steep found no type errors.')
          } else {
            vscode.window.showWarningMessage(`RailsForge: Steep found ${count} issue(s). See the Problems panel.`)
          }
        },
      )
    }),
    vscode.commands.registerCommand('railsforge.generateRBS', async () => {
      const editor = vscode.window.activeTextEditor
      const root = activeWorkspaceRoot()
      if (!editor || !root) {
        vscode.window.showWarningMessage('RailsForge: Open a Ruby file to generate RBS signatures for it.')
        return
      }
      if (editor.document.languageId !== 'ruby') {
        vscode.window.showWarningMessage('RailsForge: Not a Ruby file.')
        return
      }

      const sigDir = readConfig().typesRbsSigDir
      const outDir = path.join(root, sigDir)
      const relativePath = path.relative(root, editor.document.fileName)

      // `--base-dir=.` is not optional here: without it, `rbs prototype rb` silently
      // strips the *first* path segment from the output location (verified: `lib/x.rb`
      // -> `greeter.rbs`, `app/models/x.rb` -> `models/x.rbs`) rather than preserving the
      // full relative path, which would make `generatedPath` below wrong.
      const rbsArgs = ['prototype', 'rb', `--out-dir=${outDir}`, '--base-dir=.', relativePath]
      const ranRbs = await firstCandidate(root, 'rbs', rbsArgs, async (cmd, args) => {
        try {
          await execFileAsync(cmd, args, { cwd: root })
          return true
        } catch {
          return null
        }
      })
      if (!ranRbs) {
        vscode.window.showErrorMessage('RailsForge: Could not run `rbs prototype rb` — is the rbs gem installed (bundle add rbs --group development)?')
        return
      }

      rbsIndexes.get(root).loadFromWorkspace(root, sigDir)
      const generatedPath = path.join(outDir, `${relativePath.replace(/\.rb$/, '')}.rbs`)
      if (fs.existsSync(generatedPath)) {
        const doc = await vscode.workspace.openTextDocument(generatedPath)
        await vscode.window.showTextDocument(doc)
      }
      vscode.window.showInformationMessage(`RailsForge: Generated RBS prototype for ${relativePath} in ${sigDir}/.`)
    }),
    vscode.commands.registerCommand('railsforge.showLearningResource', (resource: LearningResource) => {
      vscode.window.showInformationMessage(`📚 ${resource.book}\n${resource.chapter}`, { modal: true, detail: resource.note })
    }),
    vscode.commands.registerCommand(
      'railsforge.applyChatResponse',
      async (responseText: string, uriString: string, command: string, selection: string) => {
        const targetUri = vscode.Uri.parse(uriString)
        const workspaceRoot = workspaceRootFor(targetUri)
        if (!workspaceRoot) { return }
        const result = await smartApplyResponse(responseText, {
          workspaceRoot,
          activeFileUri: targetUri,
          command,
          selection: selection || undefined,
        })
        if (!result.applied) {
          Logger.info(`[Chat] smartApply: ${result.message}`)
        } else {
          Logger.info(`[Chat] Changes applied: ${result.message}`)
        }
      },
    ),
  )
}

function applyStyleGuideToWorkspace(root: string, guide: RuboCopStyleGuideId): { gemAdded: boolean; ymlChanged: boolean } {
  const app = getStyleGuideApplication(guide)

  const gemfilePath = path.join(root, 'Gemfile')
  const gemfileContent = fs.existsSync(gemfilePath) ? fs.readFileSync(gemfilePath, 'utf8') : ''
  const gemResult = ensureGemInGemfile(gemfileContent, app.gemName)
  if (gemResult.changed) {fs.writeFileSync(gemfilePath, gemResult.content, 'utf8')}

  if (app.extraFile) {
    const extraPath = path.join(root, app.extraFile.name)
    if (!fs.existsSync(extraPath)) {fs.writeFileSync(extraPath, app.extraFile.content, 'utf8')}
  }

  const rubocopYmlPath = path.join(root, '.rubocop.yml')
  const rubocopYmlContent = fs.existsSync(rubocopYmlPath) ? fs.readFileSync(rubocopYmlPath, 'utf8') : ''
  const ymlResult = app.inheritFromEntry
    ? applyAirbnbInheritFrom(rubocopYmlContent, app.inheritFromEntry)
    : applyInheritGemBlock(rubocopYmlContent, app.rubocopYmlBlock ?? '', app.alreadyAppliedMarker)
  if (ymlResult.changed) {fs.writeFileSync(rubocopYmlPath, ymlResult.content, 'utf8')}

  return { gemAdded: gemResult.changed, ymlChanged: ymlResult.changed }
}

function formatRubyDocEntry(entry: RubyDocEntry): string {
  const lines = [
    `# ${entry.className}${entry.signature ? `#${entry.signature}` : `#${entry.methodName}`}`,
    '',
    `*${entry.gem} v${entry.version} (rubydoc.info)*`,
    '',
  ]
  if (entry.description) {lines.push(entry.description, '')}
  if (entry.params.length > 0) {
    lines.push('**Parameters:**', '')
    for (const p of entry.params) {
      lines.push(`- \`${p.name}\`${p.type ? ` *(${p.type})*` : ''}${p.description ? ` — ${p.description}` : ''}`)
    }
    lines.push('')
  }
  if (entry.returnType) {lines.push(`**Returns:** *(${entry.returnType})*`, '')}
  if (entry.sourceLocation) {lines.push(`**Source:** \`${entry.sourceLocation}\``, '')}
  lines.push(`[Open full docs](${entry.url})`)
  return lines.join('\n')
}

/**
 * Resolves the shell command to run a single test at `line` in `uri`. The path convention
 * (spec/ vs test/) decides the framework when unambiguous; `railsForge.testing.framework`
 * only breaks the tie for a file that lives in neither (e.g. a custom test layout).
 * Rails' `bin/rails test file:line` syntax doesn't exist outside a Rails app, so a plain
 * Minitest gem/script test runs the whole file instead of one line — Minitest itself has
 * no universal line-based selection.
 */
/**
 * Agent-native integrations, each feature-detected (the engine floor is ^1.96, but these
 * APIs only exist on newer hosts / forks): Language Model tools for agent mode and a native
 * MCP server definition provider for the bundled RailsForge MCP server.
 */
function registerAgentIntegrations(context: vscode.ExtensionContext): void {
  const lm = (vscode as unknown as { lm?: { registerTool?: unknown; registerMcpServerDefinitionProvider?: unknown } }).lm

  if (typeof lm?.registerTool === 'function') {
    const toolDisposables = registerRailsLanguageModelTools({
      lm: vscode.lm as unknown as LmApiLike,
      createContext: root => semanticContexts.get(root),
      getRoot: () => activeWorkspaceRoot(),
      toResult: text => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]),
      log: message => Logger.debug(message),
    })
    context.subscriptions.push(...toolDisposables)
    Logger.info(`Registered ${toolDisposables.length - 1} RailsForge Language Model tools.`)
  } else {
    Logger.debug('vscode.lm.registerTool is unavailable in this host; skipping Language Model tools.')
  }

  const serverPath = path.join(context.extensionPath, 'dist', 'mcp', 'server.js')
  const McpStdio = (vscode as unknown as { McpStdioServerDefinition?: new (label: string, command: string, args?: string[], env?: Record<string, string | number | null>, version?: string) => unknown }).McpStdioServerDefinition
  if (typeof lm?.registerMcpServerDefinitionProvider === 'function' && McpStdio && fs.existsSync(serverPath)) {
    const changed = new vscode.EventEmitter<void>()
    context.subscriptions.push(changed, onConfigChanged(() => changed.fire()))
    const provider = {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: () => {
        if (!readConfig().mcpEnabled) {return []}
        // One server per workspace root: each reads its own schema/routes/index.
        return workspaceRoots().map(root => new McpStdio(
          `RailsForge (${path.basename(root)})`,
          'node',
          [serverPath],
          { RAILSFORGE_WORKSPACE_ROOT: root },
          context.extension.packageJSON.version as string,
        ))
      },
    }
    context.subscriptions.push(
      (lm.registerMcpServerDefinitionProvider as (id: string, p: unknown) => vscode.Disposable)('railsforge.mcp', provider),
    )
    Logger.info('Registered the RailsForge MCP server definition provider.')
  } else {
    Logger.debug('MCP server definition provider API unavailable (older host) or server bundle missing; the .cursor/mcp.json writer remains.')
  }
}

/** One tool context (and cached semantic graph) per workspace root; shared by the agent and virtual docs. */
let skillsPackDir: string | undefined
const semanticContexts = new PerRootRegistry<ToolContext>(root => new ToolContext(root, skillsPackDir, readConfig().skillsExtraPaths))

/** Per-workspace UI memory (last analyzers / generator), initialised in activate(). */
let projectState: ProjectState | undefined

/** Runs the configured (or user-picked) analyzers over the active project and publishes findings. */
async function runCodeAnalyzers(provider: RubyAnalyzersProvider): Promise<void> {
  const root = activeWorkspaceRoot()
  if (!root) {
    vscode.window.showWarningMessage('RailsForge: Open a Ruby project to run analyzers.')
    return
  }
  const cfg = readConfig()
  let ids = cfg.analyzersEnabled.filter((x): x is AnalyzerId => (ANALYZER_IDS as readonly string[]).includes(x))
  if (ids.length === 0) {
    const picked = await vscode.window.showQuickPick(
      ANALYZER_IDS.map(id => ({ label: id, picked: (projectState?.get<string[]>('lastAnalyzers', ['reek', 'flog']) ?? ['reek', 'flog']).includes(id) })),
      { canPickMany: true, placeHolder: 'Analyzers to run (they must be in your Gemfile; set railsForge.analyzers.enabled to skip this prompt)' },
    )
    if (!picked || picked.length === 0) {return}
    ids = picked.map(p => p.label as AnalyzerId)
    void projectState?.set('lastAnalyzers', ids)
  }

  const results = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `RailsForge: running ${ids.join(', ')}…`, cancellable: true },
    async (_progress, token) => {
      const abort = new AbortController()
      token.onCancellationRequested(() => abort.abort())
      const out: AnalyzerRunResult[] = []
      for (const id of ids) {
        if (token.isCancellationRequested) {break}
        out.push(await provider.runAnalyzer(root, id, cfg.analyzersPaths, cfg.analyzersFlogThreshold, abort.signal))
      }
      return out
    },
  )

  const total = provider.publish(root, results)
  const summary = results.map(r => r.status === 'ok' ? `${r.id}: ${r.findings.length}` : `${r.id}: ${r.status}`).join(' · ')
  const unavailable = results.filter(r => r.status === 'unavailable').map(r => r.id)
  Logger.info(`[analyzers] ${summary}`)
  for (const r of results.filter(x => x.status !== 'ok' && x.detail)) {Logger.warn(`[analyzers] ${r.id} ${r.status}: ${r.detail}`)}
  vscode.window.showInformationMessage(
    `RailsForge: ${total} finding(s) in Problems — ${summary}${unavailable.length > 0 ? `. Not installed: ${unavailable.join(', ')} (bundle add … --group development).` : ''}`,
  )
}

interface GeneratorRunResult {
  ok: boolean
  output: string
}

/** Runs `rails <args>` through the project toolchain, returning combined output even on failure. */
async function execRails(root: string, args: string[]): Promise<GeneratorRunResult> {
  for (const c of rubyCandidates(root, 'rails', args)) {
    try {
      const { stdout, stderr } = await execFileAsync(c.command, c.args, { cwd: root, maxBuffer: 10 * 1024 * 1024, timeout: 120_000 })
      return { ok: true, output: `${stdout}${stderr}` }
    } catch (err: unknown) {
      const e = err as { code?: string; stdout?: string; stderr?: string; message?: string }
      if (e.code === 'ENOENT') {continue}
      return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` || (e.message ?? 'rails failed') }
    }
  }
  return { ok: false, output: 'Could not launch `rails` (no bin/rails, bundler or rails executable found).' }
}

/** `rails generate` / `rails destroy` driven from the UI: validated input, argv execution, parsed result. */
async function runRailsGenerator(mode: GeneratorMode, rubocop: RuboCopProvider): Promise<void> {
  const root = activeWorkspaceRoot()
  if (!root || !fs.existsSync(path.join(root, 'config', 'application.rb'))) {
    vscode.window.showWarningMessage('RailsForge: Open a Rails application to use the generators.')
    return
  }

  // Most recently used generator first, so the common repeat (model, model, model…) is one Enter.
  const lastKind = projectState?.get<string>('lastGenerator', '')
  const ordered = [...GENERATORS].sort((a, b) => Number(b.id === lastKind) - Number(a.id === lastKind))
  const kind = await vscode.window.showQuickPick(
    ordered.map(g => ({ label: g.label, description: g.id === lastKind ? `${g.description} · last used` : g.description, generator: g })),
    { placeHolder: mode === 'generate' ? 'Rails generator to run' : 'Generator to destroy (removes the files it created)' },
  )
  if (!kind) {return}
  void projectState?.set('lastGenerator', kind.generator.id)

  const name = await vscode.window.showInputBox({ prompt: kind.generator.namePrompt, validateInput: validateGeneratorName })
  if (!name) {return}

  let attributes: string[] = []
  if (kind.generator.takesAttributes && mode === 'generate') {
    const raw = await vscode.window.showInputBox({
      prompt: 'Attributes / actions (space separated, optional) — e.g. name:string email:string:index',
      validateInput: value => {
        const parsed = parseAttributes(value)
        return 'error' in parsed ? parsed.error : undefined
      },
    })
    if (raw === undefined) {return}
    const parsed = parseAttributes(raw)
    if ('error' in parsed) {return}
    attributes = parsed.attributes
  }

  const args = buildGeneratorArgs(mode, kind.generator.id, name, attributes)
  if (mode === 'destroy') {
    const confirm = await vscode.window.showWarningMessage(
      `This runs "rails ${args.join(' ')}" and deletes the files that generator created. Continue?`,
      { modal: true },
      'Destroy',
    )
    if (confirm !== 'Destroy') {return}
  }

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `RailsForge: rails ${args.slice(0, 3).join(' ')}…` },
    () => execRails(root, args),
  )
  Logger.info(`[generator] rails ${args.join(' ')} -> ${result.ok ? 'ok' : 'failed'}\n${result.output}`)
  if (!result.ok) {
    const choice = await vscode.window.showErrorMessage(`RailsForge: rails ${args[0]} ${args[1]} failed.`, 'Show Log')
    if (choice === 'Show Log') {Logger.show(false)}
    return
  }

  const parsed = parseGeneratorOutput(result.output)
  if (parsed.conflicts.length > 0) {
    vscode.window.showWarningMessage(`RailsForge: ${parsed.conflicts.length} file(s) already existed and were not overwritten: ${parsed.conflicts.join(', ')}`)
  }
  if (mode === 'destroy') {
    vscode.window.showInformationMessage(`RailsForge: removed ${parsed.removed.length} file(s).`)
    return
  }

  const files = parsed.created.map(f => path.join(root, f)).filter(f => fs.existsSync(f))
  if (files.length === 0) {
    vscode.window.showInformationMessage('RailsForge: generator finished — no new files were created.')
    return
  }
  const preferred = files.find(f => !/[\\/]db[\\/]migrate[\\/]/.test(f)) ?? files[0]
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(preferred))

  const rubyFiles = files.filter(f => f.endsWith('.rb'))
  const choice = await vscode.window.showInformationMessage(
    `RailsForge: created ${files.length} file(s).`,
    ...(rubyFiles.length > 0 ? ['Run RuboCop autocorrect on new files'] : []),
  )
  if (choice) {
    const results = await Promise.all(rubyFiles.map(f => rubocop.autoCorrectFile(vscode.Uri.file(f))))
    vscode.window.showInformationMessage(`RailsForge: RuboCop autocorrected ${results.filter(Boolean).length}/${rubyFiles.length} file(s).`)
  }
}

function currentShellKind(): ShellKind {
  return shellKindFromPath(vscode.env.shell)
}

/** Tool + args for a single test (rspec, rails test, or plain minitest) at `uri:line`. */
function singleTestInvocation(uri: vscode.Uri, line: number, env: ProjectEnvironment): { tool: string; args: string[] } {
  const isRSpec = hasPathSegment(uri.fsPath, 'spec')
    ? true
    : hasPathSegment(uri.fsPath, 'test')
      ? false
      : readConfig().testingFramework === 'rspec'

  if (isRSpec) {return { tool: 'rspec', args: [`${uri.fsPath}:${line}`] }}
  return env.hasRails
    ? { tool: 'rails', args: ['test', `${uri.fsPath}:${line}`] }
    : { tool: 'ruby', args: ['-Itest', uri.fsPath] }
}

function buildSingleTestCommand(uri: vscode.Uri, line: number, env: ProjectEnvironment): string {
  const { tool, args } = singleTestInvocation(uri, line, env)
  const root = workspaceRootFor(uri) ?? path.dirname(uri.fsPath)
  return rubyTerminalCommand(root, tool, args, currentShellKind())
}

/** Terminal rooted at the project that owns `uri` (never an arbitrary first folder). */
function createProjectTerminal(name: string, uri?: vscode.Uri): vscode.Terminal {
  return vscode.window.createTerminal({ name, cwd: workspaceRootFor(uri) })
}

function navigateCompanion(mvc: MVCNavigator, targetType: string): void {
  const editor = vscode.window.activeTextEditor
  const root = activeWorkspaceRoot()
  if (!editor || !root) {return}

  const paths = mvc.getCompanionPaths(editor.document.fileName, root)
  const targetPath = paths[targetType]
  if (targetPath && fs.existsSync(targetPath)) {
    void vscode.workspace.openTextDocument(targetPath).then(doc => vscode.window.showTextDocument(doc))
  } else {
    vscode.window.showWarningMessage(`Companion ${targetType} not found at ${targetPath}`)
  }
}

/**
 * Unlike model/controller/spec, "the" view isn't a single companion file —
 * `getCompanionPaths` only resolves a `viewDir` (a directory can hold index/show/new/edit/
 * etc. templates), so this lists what's actually in it rather than guessing one path via
 * `navigateCompanion`'s single-file lookup, which is why `railsforge.goToView` needs its
 * own handler.
 */
async function navigateToView(mvc: MVCNavigator): Promise<void> {
  const editor = vscode.window.activeTextEditor
  const root = activeWorkspaceRoot()
  if (!editor || !root) {return}

  const viewDir = mvc.getCompanionPaths(editor.document.fileName, root).viewDir
  if (!viewDir || !fs.existsSync(viewDir)) {
    vscode.window.showWarningMessage(`RailsForge: No view directory found${viewDir ? ` at ${viewDir}` : ''}.`)
    return
  }

  const templates = fs.readdirSync(viewDir).filter(f => /\.(erb|haml|slim|builder|jbuilder)$/.test(f)).sort()
  if (templates.length === 0) {
    vscode.window.showWarningMessage(`RailsForge: No view templates found in ${viewDir}.`)
    return
  }

  const chosen = templates.length === 1 ? templates[0] : await vscode.window.showQuickPick(templates, { placeHolder: `Select a view in ${path.basename(viewDir)}/` })
  if (!chosen) {return}

  const doc = await vscode.workspace.openTextDocument(path.join(viewDir, chosen))
  await vscode.window.showTextDocument(doc)
}

export function deactivate(): void {
  // Clean up
}
