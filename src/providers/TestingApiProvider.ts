/**
 * TestingApiProvider - wraps the native VS Code Testing API (`vscode.tests`).
 *
 * VS Code 1.65+ ships a first-class Testing API that replaces the fragmented third-party
 * test runner extensions (Rails-Minitest, Rails-RSpec-via-extensions, etc.). RailsForge
 * uses Tree-sitter to drive AST-based test discovery - tests appear in the Testing
 * sidebar instantly, without first running the suite to populate the tree.
 *
 * This provider is purely the VS Code adapter. The actual Tree-sitter parsing of
 * `RSpec.describe` and `Minitest` classes lives in `src/testing/TestDiscovery.ts` and
 * is fully unit-tested without VS Code. The RSpec/Minitest execution + JSON result
 * parsing lives in `src/testing/TestResultParsers.ts`.
 *
 * The factories below let the registry plug in the existing TestExplorerController
 * (already wired in extension.ts) without this file needing to import it directly.
 */

import * as vscode from 'vscode'
import { SemanticIndex } from './SemanticIndex'
import { PatternCatalogAccess } from './PatternCatalogAccess'

/** Controller id - stable across activations, used by VS Code to persist expansion state. */
export const RAILSFORGE_TEST_CONTROLLER_ID = 'railsforge-tests'

/** A factory that builds the TestController and its run profiles. */
export interface TestingApiFactory {
  /**
   * Returns the created TestController plus the disposables that own it. The provider
   * pushes these disposables onto its own list and returns nothing - VS Code owns the
   * TestController once it's been created.
   */
  (index: SemanticIndex, catalog: PatternCatalogAccess): vscode.Disposable
}

/**
 * Wraps `vscode.tests.createTestController` plus `TestRunProfile` registration.
 * Owns the disposable lifetime; the registry constructs this once per activation.
 */
export class TestingApiProvider implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []
  private controller: vscode.TestController | undefined

  constructor(
    private readonly index: SemanticIndex,
    private readonly catalog: PatternCatalogAccess,
    private readonly factory: TestingApiFactory,
  ) {}

  activate(): void {
    // The factory is responsible for calling vscode.tests.createTestController() and
    // creating TestRunProfile entries (run / debug / coverage) on it. We just hold the
    // disposables.
    const disposable = this.factory(this.index, this.catalog)
    this.disposables.push(disposable)
  }

  /**
   * Refresh the test tree. Called by the FileSystemWatcher provider when a `*_spec.rb`
   * or `*_test.rb` file is created/deleted/renamed.
   */
  refreshTests(): void {
    // TestExplorerController exposes its own refresh handler; the registry wires the
    // concrete implementation to this method via a callback passed at construction time
    // if needed. For now this is a no-op stub the registry can override.
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables.length = 0
    this.controller = undefined
  }
}
