/**
 * PatternCatalogAccess - read-only window into the RailsForge PatternCatalog and the
 * project's own pattern instances (ProjectPatternIndexer).
 *
 * Like `SemanticIndex`, this module is part of the engine-side firewall: providers
 * consume this interface, never the concrete `PatternCatalog` / `ProjectPatternIndexer`
 * modules directly. That keeps `src/providers/*.ts` free of business-logic imports and
 * lets providers be unit-tested with stubbed catalogs.
 *
 * The catalog is the original RailsForge-authored explanations of design patterns
 * (Service Object, Query Object, Form Object, Policy, Decorator, Concern, ...). The
 * project pattern index is the set of pattern instances the user's own codebase
 * already contains - surfaced as "3 similar services" CodeLenses and as context for
 * the `@rails /extract-service` chat command.
 */

/** Mirrors `PatternCategory` from `src/patterns/PatternCatalog.ts`. */
export type PatternCategory = 'rails' | 'behavioral' | 'structural' | 'creational'

/** Mirrors `PatternType` from `src/patterns/ProjectPatternIndexer.ts`. */
export type PatternType = 'service' | 'query' | 'form' | 'policy' | 'decorator' | 'concern'

/** A design pattern explanation from the RailsForge catalog. */
export interface CatalogPatternEntry {
  id: string
  category: PatternCategory
  name: string
  /** One-line summary shown beside the tree node and in CodeLens tooltips. */
  summary: string
  intent: string
  whenToUse: readonly string[]
  watchOutFor: readonly string[]
  /** Ruby source - original to RailsForge, never copied from Refactoring.Guru. */
  example: string
  /** Project directory kind whose classes are listed as "in this project". */
  projectKind?: PatternType
  /** Command id (registered in package.json) that scaffolds a new instance. */
  generateCommand?: string
  /** Ids of closely related catalog entries. */
  related?: readonly string[]
  reference?: { label: string; url: string }
}

/** A pattern instance the user's own codebase already contains. */
export interface ProjectPatternInstance {
  id: string
  type: PatternType
  name: string
  /** Workspace-relative path with forward slashes. */
  filePath: string
  lineStart: number
  superclass?: string
  publicMethods: readonly string[]
  preview: string
}

/**
 * Read-only access to the catalog and the project's pattern instances.
 */
export interface PatternCatalogAccess {
  /** All catalog entries, in canonical order. */
  listCatalog(): readonly CatalogPatternEntry[]

  /** Look up a single catalog entry by id. */
  getCatalogEntry(id: string): CatalogPatternEntry | undefined

  /** All pattern instances the project currently contains. */
  listProjectInstances(): readonly ProjectPatternInstance[]

  /** Project instances filtered by type. */
  projectInstancesByType(type: PatternType): readonly ProjectPatternInstance[]

  /**
   * Find project instances whose public-method set overlaps `methodNames` by at least
   * `minOverlap` methods. Used by `PrincipleCodeActionProvider` to suggest cloning an
   * existing service instead of creating a new one ("3 similar services" CodeLens).
   */
  findSimilarInstances(methodNames: readonly string[], minOverlap: number): readonly ProjectPatternInstance[]
}
