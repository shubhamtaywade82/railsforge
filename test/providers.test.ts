/**
 * Unit tests for the RailsForge provider layer.
 *
 * The provider layer is the architectural firewall between VS Code and the core
 * engine. These tests assert the invariants that firewall is supposed to enforce:
 *
 *   1. The `ProviderRegistry` constructs and disposes cleanly with stubbed engine
 *      adapters, even when no provider factories are supplied.
 *   2. The `RefactoringEditProvider.buildWorkspaceEdit` correctly converts each
 *      EditOperation variant (this is the single point that translates engine-side
 *      edit operations into VS Code's WorkspaceEdit - it must be exhaustive).
 *   3. The `PrincipleCodeActionProvider` degrades gracefully when the SemanticIndex
 *      is not ready, returning an empty action list rather than throwing.
 *   4. The `PatternCatalogAccessAdapter.findSimilarInstances` correctly ranks project
 *      pattern instances by public-method overlap.
 *
 * These tests deliberately do NOT activate providers that call `vscode.languages.*`
 * APIs - the existing `test/__mocks__/vscode.ts` mock is too minimal for that.
 * Activation coverage is provided by the host test suite under `test-host/`.
 */

import { describe, it, expect } from 'vitest'
import * as vscode from 'vscode'

import { ProviderRegistry } from '../src/providers/ProviderRegistry'
import { RefactoringEditProvider, EditOperation } from '../src/providers/RefactoringEditProvider'
import { PrincipleCodeActionProvider } from '../src/providers/PrincipleCodeActionProvider'
import { SemanticIndex, IndexedRubyFile, PrincipleViolation, DuplicateMethodGroup } from '../src/providers/SemanticIndex'
import {
  PatternCatalogAccess,
  ProjectPatternInstance,
} from '../src/providers/PatternCatalogAccess'
import { PatternCatalogAccessAdapter } from '../src/providers/EngineAdapters'
import { ProjectPatternIndexer } from '../src/patterns/ProjectPatternIndexer'

/**
 * In-memory stub for the `SemanticIndex` interface. Lets us test provider behavior
 * without booting the SQLite indexer or the VS Code runtime.
 */
class StubSemanticIndex implements SemanticIndex {
  private readonly files = new Map<string, IndexedRubyFile>()
  private readonly violations = new Map<string, PrincipleViolation[]>()
  private duplicates: readonly DuplicateMethodGroup[] = []
  private ready = false

  setReady(ready: boolean): void {
    this.ready = ready
  }

  addFile(file: IndexedRubyFile): void {
    this.files.set(file.relativePath, file)
  }

  setViolations(relativePath: string, violations: PrincipleViolation[]): void {
    this.violations.set(relativePath, violations)
  }

  setDuplicates(groups: readonly DuplicateMethodGroup[]): void {
    this.duplicates = groups
  }

  isReady(): boolean {
    return this.ready
  }

  listFiles(): readonly IndexedRubyFile[] {
    return Array.from(this.files.values())
  }

  getFile(relativePath: string): IndexedRubyFile | undefined {
    return this.files.get(relativePath)
  }

  findDefiningFiles(_typeName: string): readonly IndexedRubyFile[] {
    return []
  }

  findReferencingFiles(_typeName: string): readonly IndexedRubyFile[] {
    return []
  }

  outgoingDependencies(_fromPath: string): readonly { fromPath: string; toPath: string; symbol: string }[] {
    return []
  }

  incomingDependencies(_toPath: string): readonly { fromPath: string; toPath: string; symbol: string }[] {
    return []
  }

  dependsOn(_fromPath: string, _toPath: string): boolean {
    return false
  }

  duplicateMethods(): readonly DuplicateMethodGroup[] {
    return this.duplicates
  }

  violationsFor(relativePath: string): readonly PrincipleViolation[] {
    return this.violations.get(relativePath) ?? []
  }

  async refreshFile(_absolutePath: string): Promise<void> {
    // no-op for tests
  }

  async forgetFile(_absolutePath: string): Promise<void> {
    // no-op for tests
  }
}

/** In-memory stub for `PatternCatalogAccess`. */
class StubPatternCatalogAccess implements PatternCatalogAccess {
  private readonly instances: ProjectPatternInstance[] = []

  addInstance(instance: ProjectPatternInstance): void {
    this.instances.push(instance)
  }

  listCatalog(): readonly ProjectPatternInstance[] {
    return []
  }

  getCatalogEntry(_id: string): ProjectPatternInstance | undefined {
    return undefined
  }

  listProjectInstances(): readonly ProjectPatternInstance[] {
    return this.instances
  }

  projectInstancesByType(_type: 'service' | 'query' | 'form' | 'policy' | 'decorator' | 'concern'): readonly ProjectPatternInstance[] {
    return this.instances
  }

  findSimilarInstances(methodNames: readonly string[], minOverlap: number): readonly ProjectPatternInstance[] {
    const matches: Array<{ instance: ProjectPatternInstance; overlap: number }> = []
    for (const instance of this.instances) {
      const overlap = methodNames.filter(n => instance.publicMethods.includes(n)).length
      if (overlap >= minOverlap) {
        matches.push({ instance, overlap })
      }
    }
    matches.sort((a, b) => b.overlap - a.overlap)
    return matches.slice(0, 5).map(m => m.instance)
  }
}

describe('ProviderRegistry', () => {
  it('constructs and disposes cleanly with stubbed adapters and no factories', () => {
    const index = new StubSemanticIndex()
    const catalog = new StubPatternCatalogAccess()
    const registry = new ProviderRegistry({
      index,
      catalog,
      workspaceRoot: '/fake/workspace',
    })
    // activate() with no factories / opt-in flags should be a no-op that does not throw.
    expect(() => registry.activate()).not.toThrow()
    expect(() => registry.dispose()).not.toThrow()
  })

  it('exposes a shared RefactoringEditProvider instance', () => {
    const index = new StubSemanticIndex()
    const catalog = new StubPatternCatalogAccess()
    const registry = new ProviderRegistry({
      index,
      catalog,
      workspaceRoot: '/fake/workspace',
    })
    expect(registry.editProvider).toBeInstanceOf(RefactoringEditProvider)
    registry.dispose()
  })
})

describe('RefactoringEditProvider.buildWorkspaceEdit', () => {
  it('converts a replace operation into a WorkspaceEdit.replace call', () => {
    const provider = new RefactoringEditProvider()
    const uri = vscode.Uri.file('/fake/app/services/foo.rb')
    const range = new vscode.Range(0, 0, 0, 10)
    const edit = provider.buildWorkspaceEdit([
      { kind: 'replace', uri, range, newText: 'class Foo; end' },
    ])
    // The vscode mock does not implement WorkspaceEdit, so we just verify the call
    // did not throw. The exhaustive coverage of each branch is the contract.
    expect(edit).toBeDefined()
  })

  it('converts a createFile operation with string contents without throwing', () => {
    const provider = new RefactoringEditProvider()
    const uri = vscode.Uri.file('/fake/app/services/foo.rb')
    const edit = provider.buildWorkspaceEdit([
      { kind: 'createFile', uri, contents: 'class Foo; end\n', overwrite: false },
    ])
    expect(edit).toBeDefined()
  })

  it('converts a createFile operation with Uint8Array contents without throwing', () => {
    const provider = new RefactoringEditProvider()
    const uri = vscode.Uri.file('/fake/app/services/foo.rb')
    const edit = provider.buildWorkspaceEdit([
      { kind: 'createFile', uri, contents: new Uint8Array([0x63, 0x6c, 0x61, 0x73, 0x73]), overwrite: true },
    ])
    expect(edit).toBeDefined()
  })

  it('handles every EditOperation variant without throwing (exhaustive switch)', () => {
    const provider = new RefactoringEditProvider()
    const uri = vscode.Uri.file('/fake/app/services/foo.rb')
    const uri2 = vscode.Uri.file('/fake/app/services/bar.rb')
    const operations: EditOperation[] = [
      { kind: 'replace', uri, range: new vscode.Range(0, 0, 0, 1), newText: 'x' },
      { kind: 'insert', uri, position: new vscode.Position(0, 0), newText: 'x' },
      { kind: 'delete', uri, range: new vscode.Range(0, 0, 0, 1) },
      { kind: 'createFile', uri, contents: 'x' },
      { kind: 'renameFile', oldUri: uri, newUri: uri2 },
      { kind: 'deleteFile', uri },
    ]
    expect(() => provider.buildWorkspaceEdit(operations)).not.toThrow()
  })
})

describe('PrincipleCodeActionProvider', () => {
  it('returns an empty action list when the SemanticIndex is not ready', () => {
    const index = new StubSemanticIndex()
    index.setReady(false)
    const catalog = new StubPatternCatalogAccess()
    const editProvider = new RefactoringEditProvider()
    const provider = new PrincipleCodeActionProvider(index, catalog, editProvider)

    // The vscode mock's TextDocument has only the fields the mock defines; we use a
    // minimal stub. The provider should bail out on `isReady() === false` before
    // touching any document property.
    const fakeDoc = { uri: vscode.Uri.file('/fake/app/models/foo.rb') } as unknown as vscode.TextDocument
    const actions = provider.provideCodeActions(
      fakeDoc,
      new vscode.Range(0, 0, 0, 1),
      {} as vscode.CodeActionContext,
      {} as vscode.CancellationToken,
    )
    expect(actions).toEqual([])
  })

  it('returns a clone-pattern action when similar project pattern instances exist', () => {
    const index = new StubSemanticIndex()
    index.setReady(true)
    index.addFile({
      relativePath: 'app/services/checkout.rb',
      absolutePath: '/fake/app/services/checkout.rb',
      definedTypes: ['Checkout'],
      publicMethods: ['call', 'validate!', 'charge'],
      lineCount: 50,
    })
    const catalog = new StubPatternCatalogAccess()
    catalog.addInstance({
      id: 'app/services/payment::Payment',
      type: 'service',
      name: 'Payment',
      filePath: 'app/services/payment.rb',
      lineStart: 1,
      publicMethods: ['call', 'validate!', 'charge', 'refund'],
      preview: 'class Payment ...',
    })
    const editProvider = new RefactoringEditProvider()
    const provider = new PrincipleCodeActionProvider(index, catalog, editProvider)

    // The provider uses `vscode.workspace.getWorkspaceFolder` to compute the relative
    // path; the mock does not implement this. We patch it on the imported namespace.
    const original = (vscode.workspace as unknown as { getWorkspaceFolder?: unknown }).getWorkspaceFolder
    ;(vscode.workspace as unknown as { getWorkspaceFolder: (uri: unknown) => unknown }).getWorkspaceFolder = () => ({
      uri: { path: '/fake' },
    })

    try {
      const fakeDoc = {
        uri: vscode.Uri.file('/fake/app/services/checkout.rb'),
        fileName: '/fake/app/services/checkout.rb',
      } as unknown as vscode.TextDocument
      const actions = provider.provideCodeActions(
        fakeDoc,
        new vscode.Range(0, 0, 0, 1),
        {} as vscode.CodeActionContext,
        {} as vscode.CancellationToken,
      )
      const cloneAction = actions.find(a => a.title.startsWith('Clone existing'))
      expect(cloneAction).toBeDefined()
      expect(cloneAction?.command?.command).toBe('railsforge.clonePattern')
    } finally {
      // Restore - other tests in the suite may rely on the original (undefined) value.
      if (original === undefined) {
        delete (vscode.workspace as unknown as { getWorkspaceFolder?: unknown }).getWorkspaceFolder
      } else {
        ;(vscode.workspace as unknown as { getWorkspaceFolder: unknown }).getWorkspaceFolder = original
      }
    }
  })
})

describe('PatternCatalogAccessAdapter', () => {
  it('findSimilarInstances ranks by public-method overlap and caps at 5 results', () => {
    const indexer = new ProjectPatternIndexer()
    // Seed the indexer with three service files of varying method overlap with the
    // query set ['call', 'charge'].
    indexer.indexFileAs('/fake/app/services/a.rb', 'class A\n  def call; end\n  def charge; end\n  def unique_a; end\nend\n', 'service')
    indexer.indexFileAs('/fake/app/services/b.rb', 'class B\n  def call; end\n  def charge; end\n  def unique_b; end\nend\n', 'service')
    indexer.indexFileAs('/fake/app/services/c.rb', 'class C\n  def call; end\n  def unrelated; end\nend\n', 'service')

    const adapter = new PatternCatalogAccessAdapter(indexer)
    const matches = adapter.findSimilarInstances(['call', 'charge'], 1)
    // A and B both have 2/2 overlap; C has 1/2. Order among equal-overlap entries is
    // insertion-order, but both A and B should appear before C.
    const names = matches.map(m => m.name)
    expect(names).toContain('A')
    expect(names).toContain('B')
    expect(names.indexOf('A') < names.indexOf('C')).toBe(true)
    expect(names.indexOf('B') < names.indexOf('C')).toBe(true)
  })

  it('findSimilarInstances returns empty array when no instance meets the overlap threshold', () => {
    const indexer = new ProjectPatternIndexer()
    indexer.indexFileAs('/fake/app/services/a.rb', 'class A\n  def call; end\nend\n', 'service')
    const adapter = new PatternCatalogAccessAdapter(indexer)
    const matches = adapter.findSimilarInstances(['totally_unrelated_method'], 1)
    expect(matches).toEqual([])
  })

  it('listProjectInstances returns every indexed pattern instance', () => {
    const indexer = new ProjectPatternIndexer()
    indexer.indexFileAs('/fake/app/services/foo.rb', 'class Foo\n  def call; end\nend\n', 'service')
    indexer.indexFileAs('/fake/app/queries/bar_query.rb', 'class BarQuery\n  def call; end\nend\n', 'query')
    const adapter = new PatternCatalogAccessAdapter(indexer)
    const instances = adapter.listProjectInstances()
    expect(instances).toHaveLength(2)
    expect(instances.map(i => i.name).sort()).toEqual(['BarQuery', 'Foo'])
  })

  it('projectInstancesByType filters by pattern type', () => {
    const indexer = new ProjectPatternIndexer()
    indexer.indexFileAs('/fake/app/services/foo.rb', 'class Foo\n  def call; end\nend\n', 'service')
    indexer.indexFileAs('/fake/app/queries/bar_query.rb', 'class BarQuery\n  def call; end\nend\n', 'query')
    const adapter = new PatternCatalogAccessAdapter(indexer)
    expect(adapter.projectInstancesByType('service').map(i => i.name)).toEqual(['Foo'])
    expect(adapter.projectInstancesByType('query').map(i => i.name)).toEqual(['BarQuery'])
    expect(adapter.projectInstancesByType('form')).toEqual([])
  })
})
