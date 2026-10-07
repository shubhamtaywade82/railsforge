/**
 * ProviderRegistry - the single entry point that the extension's `activate()` function
 * uses to bring up the entire provider layer.
 *
 * Architecture invariant: `src/extension.ts` is allowed to construct a
 * `ProviderRegistry`, push it onto `context.subscriptions`, and call `activate()` on
 * it. Nothing else in the codebase outside `src/providers/` is allowed to construct
 * these classes directly. This keeps the provider layer's surface area small and
 * reviewable.
 *
 * The registry owns the lifetime of every provider it holds. Disposing the registry
 * disposes every provider, which disposes every VS Code Disposable they registered.
 *
 * Construction is intentionally cheap - no VS Code APIs are called in the constructor.
 * All registration happens in `activate()`, so unit tests can construct a registry
 * without booting VS Code and assert that `activate()` would have been safe to call.
 */

import * as vscode from 'vscode'
import { SemanticIndex } from './SemanticIndex'
import { PatternCatalogAccess } from './PatternCatalogAccess'
import { LanguageIntelligenceProvider, LanguageIntelligenceFactories } from './LanguageIntelligenceProvider'
import { TestingApiProvider, TestingApiFactory } from './TestingApiProvider'
import { AiChatProvider, ChatParticipantFactory, LanguageModelSelectorFactory, ChatContextGroundingFactory } from './AiChatProvider'
import { RefactoringEditProvider } from './RefactoringEditProvider'
import { WindowUiProvider, WindowUiConfig } from './WindowUiProvider'
import { WorkspaceFsProvider } from './WorkspaceFsProvider'
import { SourceControlProvider, SourceControlFactory, CommitMessageGenerator } from './SourceControlProvider'
import { TerminalTasksProvider, TaskProviderFactory } from './TerminalTasksProvider'

/** All inputs the registry needs to construct providers. */
export interface ProviderRegistryDeps {
  /** The active Semantic Index - usually a `PersistentIndexManager` wrapper. */
  index: SemanticIndex
  /** The active Pattern Catalog access - usually wraps `PatternCatalog` + `ProjectPatternIndexer`. */
  catalog: PatternCatalogAccess
  /** The primary workspace root (absolute fs path). Undefined in single-file mode. */
  workspaceRoot: string | undefined

  /**
   * Opt-in flags. Each provider is only activated when its corresponding flag or
   * factory is present. This lets extension.ts introduce the registry additively -
   * wiring only the providers that don't duplicate existing registrations - and
   * migrate the rest one at a time.
   */
  enableWorkspaceFs?: boolean
  enableSourceControl?: boolean
  enableTerminalTasks?: boolean

  /** Optional factories - if absent, that provider is not registered. */
  languageIntelligence?: LanguageIntelligenceFactories
  testing?: TestingApiFactory
  chatParticipant?: ChatParticipantFactory
  chatModelSelector?: LanguageModelSelectorFactory
  chatContextGrounding?: ChatContextGroundingFactory
  windowUi?: WindowUiConfig
  sourceControlFactory?: SourceControlFactory
  commitMessageGenerator?: CommitMessageGenerator
  taskProviderFactory?: TaskProviderFactory
}

/**
 * Owns every provider RailsForge registers with VS Code. Disposing this registry is
 * equivalent to deactivating the extension.
 */
export class ProviderRegistry implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []
  private readonly providers: vscode.Disposable[] = []

  /** The shared refactoring edit provider - exposed so non-provider code (chat
   *  participant, command handlers) can build WorkspaceEdits the same way providers do. */
  readonly editProvider: RefactoringEditProvider

  /** Exposed so command handlers can call provider methods (QuickPick, InputBox, ...). */
  windowUi: WindowUiProvider | undefined

  /** Exposed so the SCM command handler can call generateCommitMessage(). */
  sourceControl: SourceControlProvider | undefined

  /** Exposed so the test-refresh command handler can call refreshTests(). */
  testing: TestingApiProvider | undefined

  /** Exposed so chat command handlers can call selectModel() / buildContextGrounding(). */
  aiChat: AiChatProvider | undefined

  /** Exposed so on-save hooks can dispatch events. */
  workspaceFs: WorkspaceFsProvider | undefined

  /** Exposed so terminal-based commands (worktree, rails g) can use it. */
  terminalTasks: TerminalTasksProvider | undefined

  constructor(private readonly deps: ProviderRegistryDeps) {
    this.editProvider = new RefactoringEditProvider()
  }

  /**
   * Register every provider with VS Code. Safe to call exactly once per registry
   * instance. Pushes every Disposable onto the internal list so `dispose()` cleans
   * everything up.
   */
  activate(): void {
    const { deps } = this

    // 1. Workspace / File System - registered first so the FileSystemWatcher is live
    //    before any other provider starts reading the index. Opt-in because the
    //    existing extension.ts already creates several watchers directly; flipping
    //    this on is a follow-up migration step.
    if (deps.enableWorkspaceFs) {
      this.workspaceFs = new WorkspaceFsProvider(deps.index, deps.catalog)
      this.workspaceFs.activate()
      this.providers.push(this.workspaceFs)
    }

    // 2. Language Intelligence - the largest surface. Includes the
    //    PrincipleCodeActionProvider (built here because it's the canonical example).
    if (deps.languageIntelligence) {
      const lang = new LanguageIntelligenceProvider(deps.index, deps.catalog, deps.languageIntelligence)
      lang.activate()
      this.providers.push(lang)
    }

    // 3. Window UI - tree views and webview panels.
    if (deps.windowUi) {
      this.windowUi = new WindowUiProvider(deps.index, deps.catalog, deps.windowUi)
      this.windowUi.activate()
      this.providers.push(this.windowUi)
    }

    // 4. Testing API - native Test Explorer integration.
    if (deps.testing) {
      this.testing = new TestingApiProvider(deps.index, deps.catalog, deps.testing)
      this.testing.activate()
      this.providers.push(this.testing)
    }

    // 5. AI & Chat - the @rails participant and lm.selectChatModels.
    if (deps.chatParticipant) {
      this.aiChat = new AiChatProvider(
        deps.index,
        deps.catalog,
        deps.chatParticipant,
        deps.chatModelSelector ?? (async () => undefined),
        deps.chatContextGrounding ?? (async () => ''),
      )
      this.aiChat.activate()
      this.providers.push(this.aiChat)
    }

    // 6. Source Control - AI commit message generation. Opt-in for the same reason
    //    as WorkspaceFs: the existing extension.ts may already register SCM providers.
    if (deps.enableSourceControl) {
      this.sourceControl = new SourceControlProvider(
        deps.index,
        deps.catalog,
        deps.sourceControlFactory,
        deps.commitMessageGenerator,
      )
      this.sourceControl.activate()
      this.providers.push(this.sourceControl)
    }

    // 7. Terminal & Tasks - rails server, sidekiq, rspec, worktree automation.
    //    Opt-in because the existing extension.ts already registers a task provider.
    if (deps.enableTerminalTasks) {
      this.terminalTasks = new TerminalTasksProvider(
        deps.index,
        deps.catalog,
        deps.workspaceRoot,
        deps.taskProviderFactory,
      )
      this.terminalTasks.activate()
      this.providers.push(this.terminalTasks)
    }
  }

  /**
   * Dispose every provider. Order is the reverse of activation, mirroring VS Code's
   * own deactivate semantics. Idempotent - safe to call multiple times.
   */
  dispose(): void {
    for (let i = this.providers.length - 1; i >= 0; i--) {
      try {
        this.providers[i].dispose()
      } catch (err) {
        console.warn('[RailsForge] ProviderRegistry: provider dispose failed:', err)
      }
    }
    this.providers.length = 0
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables.length = 0
    this.windowUi = undefined
    this.sourceControl = undefined
    this.testing = undefined
    this.aiChat = undefined
    this.workspaceFs = undefined
    this.terminalTasks = undefined
  }
}
