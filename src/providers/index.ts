/**
 * Public surface of the RailsForge provider layer.
 *
 * Everything `src/extension.ts` and other modules need to consume from the provider
 * layer is re-exported here. Internal implementation files (`SemanticIndex.ts`,
 * `PatternCatalogAccess.ts`, the eight domain providers, and `PrincipleCodeActionProvider`)
 * should not be imported directly - go through this barrel.
 *
 * The architectural invariant this barrel enforces: no file outside `src/providers/`
 * ever imports a concrete engine class (`PersistentIndexManager`, `PatternCatalog`,
 * `DesignPrincipleLinter`) for VS Code adapter purposes. The registry wires the
 * concrete implementations behind the `SemanticIndex` and `PatternCatalogAccess`
 * interfaces; everyone else consumes those interfaces.
 */

// Core firewall interfaces - the engine contracts every provider consumes.
export { SemanticIndex } from './SemanticIndex'
export type {
  IndexedRubyFile,
  DependencyEdge,
  DuplicateMethodGroup,
  PrincipleViolation,
} from './SemanticIndex'

export { PatternCatalogAccess } from './PatternCatalogAccess'
export type {
  PatternCategory,
  PatternType,
  CatalogPatternEntry,
  ProjectPatternInstance,
} from './PatternCatalogAccess'

// Domain providers - one per VS Code API surface area.
export { LanguageIntelligenceProvider, RAILSFORGE_SELECTORS } from './LanguageIntelligenceProvider'
export type { LanguageIntelligenceFactories } from './LanguageIntelligenceProvider'

export { TestingApiProvider, RAILSFORGE_TEST_CONTROLLER_ID } from './TestingApiProvider'
export type { TestingApiFactory } from './TestingApiProvider'

export {
  AiChatProvider,
  RAILSFORGE_CHAT_PARTICIPANT_ID,
  RAILSFORGE_CHAT_COMMANDS,
} from './AiChatProvider'
export type {
  RailsForgeChatCommand,
  ChatParticipantFactory,
  LanguageModelSelectorFactory,
  ChatContextGroundingFactory,
} from './AiChatProvider'

export { RefactoringEditProvider } from './RefactoringEditProvider'
export type { EditOperation, RefactoringMetadata } from './RefactoringEditProvider'

export { WindowUiProvider } from './WindowUiProvider'
export type { WindowUiConfig, TreeViewFactory, WebviewPanelFactory } from './WindowUiProvider'

export {
  WorkspaceFsProvider,
  INDEXED_GLOBS,
  RAILSFORGE_CONFIG_SECTION,
} from './WorkspaceFsProvider'
export type { FileChangeHandler, ConfigChangeHandler, SaveHandler } from './WorkspaceFsProvider'

export {
  SourceControlProvider,
  RAILSFORGE_SCM_PROVIDER_ID,
} from './SourceControlProvider'
export type { SourceControlFactory, CommitMessageGenerator } from './SourceControlProvider'

export { TerminalTasksProvider, RAILSFORGE_TASK_TYPE } from './TerminalTasksProvider'
export type { TaskProviderFactory } from './TerminalTasksProvider'

// The canonical example provider - reference implementation for the team.
export { PrincipleCodeActionProvider, PRINCIPLE_ACTION_KINDS } from './PrincipleCodeActionProvider'

// The registry - single entry point for extension.ts.
export { ProviderRegistry } from './ProviderRegistry'
export type { ProviderRegistryDeps } from './ProviderRegistry'

// Engine adapters - the only files in src/providers/ that import concrete engine
// classes. They bridge PersistentIndexManager / PatternCatalog / DesignPrincipleLinter
// to the SemanticIndex / PatternCatalogAccess interfaces.
export { SemanticIndexAdapter, PatternCatalogAccessAdapter } from './EngineAdapters'
