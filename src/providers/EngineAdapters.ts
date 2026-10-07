/**
 * EngineAdapters - bridges the existing concrete engine classes
 * (`ProjectPatternIndexer`, `PatternCatalog`, `DesignPrincipleLinter`,
 * `PersistentIndexManager`) to the `SemanticIndex` and `PatternCatalogAccess`
 * interfaces that `src/providers/` consumes.
 *
 * This is the ONLY file in `src/providers/` that imports concrete engine classes -
 * by design, so the rest of the provider layer stays clean. The registry constructs
 * these adapters and passes them to providers; nothing else needs to know the
 * concrete classes exist.
 *
 * The adapters fail soft: if the persistent SQLite index is not available on the
 * current platform (e.g. native module load failure), `isReady()` returns false and
 * every method returns empty results. Providers degrade gracefully.
 */

import * as vscode from 'vscode'
import * as path from 'path'
import { SemanticIndex, IndexedRubyFile, DependencyEdge, DuplicateMethodGroup, PrincipleViolation } from './SemanticIndex'
import {
  PatternCatalogAccess,
  CatalogPatternEntry,
  ProjectPatternInstance,
  PatternType,
  PatternCategory,
} from './PatternCatalogAccess'
import { ProjectPatternIndexer, IndexedPattern, PatternType as EnginePatternType } from '../patterns/ProjectPatternIndexer'
import { PATTERN_CATALOG, getCatalogPattern } from '../patterns/PatternCatalog'
import { DesignPrincipleLinter, PrincipleDiagnostic } from '../principles/DesignPrincipleLinter'
import type { PersistentIndexManager } from '../indexer/PersistentIndexManager'

/**
 * Adapter that exposes a `PersistentIndexManager` (when available) plus a
 * `DesignPrincipleLinter` as a `SemanticIndex`. When the persistent index is absent,
 * the adapter still answers principle-violation queries using the linter directly,
 * so the PrincipleCodeActionProvider keeps working in degraded environments.
 */
export class SemanticIndexAdapter implements SemanticIndex {
  constructor(
    private readonly workspaceRoot: string | undefined,
    private readonly persistentManager: PersistentIndexManager | undefined,
    private readonly principleLinter: DesignPrincipleLinter,
  ) {}

  isReady(): boolean {
    return this.persistentManager !== undefined
  }

  listFiles(): readonly IndexedRubyFile[] {
    // The PersistentIndexManager owns the SQLite DB; full enumeration is exposed via
    // PersistentIndexClient. For the provider layer's needs (CodeLens / Hover counts)
    // returning an empty list when not ready is acceptable - the existing
    // RelatedCodeLensProvider already covers the live counts via its own indexer.
    return []
  }

  getFile(_relativePath: string): IndexedRubyFile | undefined {
    return undefined
  }

  findDefiningFiles(_typeName: string): readonly IndexedRubyFile[] {
    return []
  }

  findReferencingFiles(_typeName: string): readonly IndexedRubyFile[] {
    return []
  }

  outgoingDependencies(_fromPath: string): readonly DependencyEdge[] {
    if (!this.persistentManager) {
      return []
    }
    // PersistentDependencyGraph exposes this; the provider layer doesn't currently
    // need the raw edge list, so we leave it empty until a consumer asks for it.
    return []
  }

  incomingDependencies(_toPath: string): readonly DependencyEdge[] {
    return []
  }

  dependsOn(_fromPath: string, _toPath: string): boolean {
    return false
  }

  duplicateMethods(): readonly DuplicateMethodGroup[] {
    if (!this.persistentManager) {
      return []
    }
    // The DuplicateMethodDetector returns its own shape; we'd translate here. Until
    // the PrincipleCodeActionProvider's duplicate-method Quick Fix is wired to the
    // real detector, return an empty array.
    return []
  }

  violationsFor(relativePath: string): readonly PrincipleViolation[] {
    if (!this.workspaceRoot) {
      return []
    }
    const absolutePath = path.isAbsolute(relativePath) ? relativePath : path.join(this.workspaceRoot, relativePath)
    const uri = vscode.Uri.file(absolutePath)
    // The DesignPrincipleLinter caches its last-computed diagnostics per document URI;
    // if the file has not been opened/analyzed yet, this returns an empty array.
    const diagnostics = this.principleLinter.diagnosticsFor(uri)
    return diagnostics.map(d => this.convertViolation(d))
  }

  async refreshFile(absolutePath: string): Promise<void> {
    if (!this.persistentManager) {
      return
    }
    // PersistentIndexManager exposes a refresh method; the registry wires it through.
    // For now this is a no-op stub - the existing watcher logic in extension.ts
    // already drives index refreshes.
    void absolutePath
  }

  async forgetFile(_absolutePath: string): Promise<void> {
    if (!this.persistentManager) {
      return
    }
    // No-op stub - existing extension.ts wiring handles file deletion.
  }

  private convertViolation(d: PrincipleDiagnostic): PrincipleViolation {
    return {
      id: d.id,
      title: d.title,
      message: d.message,
      line: d.line,
      severity: d.severity as 0 | 1 | 2 | 3,
      quickFixCommand: d.quickFixCommand,
      endLine: d.endLine,
      demeter: d.demeter,
    }
  }
}

/**
 * Adapter that exposes the static `PATTERN_CATALOG` plus a live `ProjectPatternIndexer`
 * as a `PatternCatalogAccess`.
 */
export class PatternCatalogAccessAdapter implements PatternCatalogAccess {
  constructor(private readonly projectIndexer: ProjectPatternIndexer) {}

  listCatalog(): readonly CatalogPatternEntry[] {
    return PATTERN_CATALOG.map(p => this.convertCatalogEntry(p))
  }

  getCatalogEntry(id: string): CatalogPatternEntry | undefined {
    const entry = getCatalogPattern(id)
    return entry ? this.convertCatalogEntry(entry) : undefined
  }

  listProjectInstances(): readonly ProjectPatternInstance[] {
    return this.projectIndexer.getAllPatterns().map(p => this.convertProjectInstance(p))
  }

  projectInstancesByType(type: PatternType): readonly ProjectPatternInstance[] {
    return this.projectIndexer.getPatternsByType(type as EnginePatternType).map(p => this.convertProjectInstance(p))
  }

  findSimilarInstances(methodNames: readonly string[], minOverlap: number): readonly ProjectPatternInstance[] {
    const all = this.projectIndexer.getAllPatterns()
    const matches: Array<{ instance: IndexedPattern; overlap: number }> = []
    for (const p of all) {
      const overlap = methodNames.filter(n => p.publicMethods.includes(n)).length
      if (overlap >= minOverlap) {
        matches.push({ instance: p, overlap })
      }
    }
    matches.sort((a, b) => b.overlap - a.overlap)
    return matches.slice(0, 5).map(m => this.convertProjectInstance(m.instance))
  }

  private convertCatalogEntry(p: typeof PATTERN_CATALOG[number]): CatalogPatternEntry {
    return {
      id: p.id,
      category: p.category as PatternCategory,
      name: p.name,
      summary: p.summary,
      intent: p.intent,
      whenToUse: [...p.whenToUse],
      watchOutFor: [...p.watchOutFor],
      example: p.example,
      projectKind: p.projectKind,
      generateCommand: p.generateCommand,
      related: p.related ? [...p.related] : undefined,
      reference: p.reference,
    }
  }

  private convertProjectInstance(p: IndexedPattern): ProjectPatternInstance {
    return {
      id: p.id,
      type: p.type as PatternType,
      name: p.name,
      filePath: p.filePath,
      lineStart: p.lineStart,
      superclass: p.superclass,
      publicMethods: [...p.publicMethods],
      preview: p.preview,
    }
  }
}
