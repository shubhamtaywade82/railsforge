/**
 * SourceControlProvider - wraps `vscode.scm.*` (Source Control Management API).
 *
 * VS Code's SCM API lets extensions register custom source-control providers, custom
 * resource states (changed files), and - relevant for RailsForge - hook into the commit
 * message input box to provide AI-assisted commit message generation.
 *
 * RailsForge's primary SCM feature is "Generate Conventional Commit": a button in the
 * Source Control view title bar that takes the staged `git diff`, analyzes it via the
 * Semantic Index (which files belong to which patterns), and proposes a Conventional
 * Commit message like `feat(orders): extract CheckoutService from controller`.
 *
 * This provider is the SCM adapter. The actual diff parsing and commit-message
 * generation logic lives in the engine layer, fully unit-tested without VS Code.
 */

import * as vscode from 'vscode'
import { SemanticIndex } from './SemanticIndex'
import { PatternCatalogAccess } from './PatternCatalogAccess'

/** Stable id for the RailsForge SCM provider - VS Code persists this across activations. */
export const RAILSFORGE_SCM_PROVIDER_ID = 'railsforge.scm'

/**
 * Factory: build a `vscode.SourceControl` instance with its resource groups. The
 * factory pattern keeps the SCM-specific engine logic (git diff parsing, Conventional
 * Commit generation) out of this file.
 */
export interface SourceControlFactory {
  (index: SemanticIndex, catalog: PatternCatalogAccess): vscode.SourceControl
}

/**
 * Commit-message generator: takes the staged diff text and returns a Conventional
 * Commit message. Returns undefined if no commit could be confidently generated.
 */
export interface CommitMessageGenerator {
  (stagedDiff: string, index: SemanticIndex, catalog: PatternCatalogAccess): Promise<string | undefined>
}

/**
 * Wraps `vscode.scm.createSourceControl` and the AI commit-message flow.
 */
export class SourceControlProvider implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []
  private sourceControl: vscode.SourceControl | undefined
  private readonly generator: CommitMessageGenerator | undefined

  constructor(
    private readonly index: SemanticIndex,
    private readonly catalog: PatternCatalogAccess,
    factory: SourceControlFactory | undefined,
    generator?: CommitMessageGenerator,
  ) {
    if (factory) {
      try {
        this.sourceControl = factory(this.index, this.catalog)
        this.disposables.push(this.sourceControl)
      } catch (err) {
        console.warn('[RailsForge] SourceControlProvider: source control registration failed:', err)
      }
    }
    this.generator = generator
  }

  activate(): void {
    // SCM provider is created in the constructor so the package.json command handler
    // `railsforge.generateAiCommit` can find it via the SourceControl view title bar.
    // Nothing further to do here.
  }

  /**
   * Generate a Conventional Commit message from the currently staged diff. Called by
   * the `railsforge.generateAiCommit` command (registered in package.json) when the
   * user clicks the magic-wand button in the Source Control view title bar.
   */
  async generateCommitMessage(stagedDiff: string): Promise<string | undefined> {
    if (!this.generator) {
      return undefined
    }
    try {
      return await this.generator(stagedDiff, this.index, this.catalog)
    } catch (err) {
      console.warn('[RailsForge] SourceControlProvider.generateCommitMessage failed:', err)
      return undefined
    }
  }

  /**
   * Push the generated message into the Source Control input box. The user can still
   * edit it before committing - we never auto-commit.
   */
  setCommitMessage(message: string): void {
    if (this.sourceControl) {
      this.sourceControl.inputBox.value = message
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables.length = 0
    this.sourceControl = undefined
  }
}
