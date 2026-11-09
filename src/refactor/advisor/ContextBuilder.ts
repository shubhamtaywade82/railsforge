/**
 * ContextBuilder - gathers what the model needs beyond the target itself, across files:
 *   - related files: where the constants the target references are defined (via the semantic index)
 *   - specs: the conventional spec/test file for the primary file, so refactors respect how it is tested
 *   - callers: files that depend on the primary file (the blast radius of a change)
 *   - conventions: the project's existing pattern instances (services, queries, forms, ...)
 *
 * Every excerpt is clipped and the whole context stays within `suggestContextMaxChars`. Lower-value
 * material is dropped before higher-value material, so the budget never truncates the target.
 */

import { ADVISOR_LIMITS, AdvisorCatalog, AdvisorIndex, RefactorTarget, SourceReader } from './types'
import { specCandidates } from './PathGuard'

export interface ContextExcerpt {
  path: string
  excerpt: string
}

export interface AdvisorContext {
  primaryPath: string
  /** The whole primary file, when it fits `primaryFileMaxChars`. Otherwise undefined and the target stands in. */
  primarySource: string | undefined
  related: Array<ContextExcerpt & { referencedAs: string[] }>
  specs: ContextExcerpt[]
  callers: string[]
  conventions: string[]
}

/** Ruby constant references: `Order`, `Payments::Gateway`. Lookbehind keeps `foo.Bar` and `@Baz` out. */
const CONSTANT_REF = /(?<![\w:@$.])([A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*)/g
const MAX_CONSTANTS_LOOKED_UP = 8

export class ContextBuilder {
  constructor(
    private readonly index: AdvisorIndex,
    private readonly files: SourceReader,
    private readonly catalog: AdvisorCatalog,
  ) {}

  async build(input: { relativePath: string; content: string; target: RefactorTarget }): Promise<AdvisorContext> {
    const { relativePath, content, target } = input
    let budget = ADVISOR_LIMITS.suggestContextMaxChars

    const primarySource = content.length <= ADVISOR_LIMITS.primaryFileMaxChars ? content : undefined
    if (primarySource !== undefined) {budget -= primarySource.length}

    const related = await this.relatedFiles(relativePath, target.text)
    const relatedKept: AdvisorContext['related'] = []
    for (const item of related) {
      const excerpt = clip(item.content, ADVISOR_LIMITS.excerptMaxChars)
      if (excerpt.length > budget) {break}
      budget -= excerpt.length
      relatedKept.push({ path: item.path, excerpt, referencedAs: item.referencedAs })
    }

    const specs: ContextExcerpt[] = []
    for (const candidate of specCandidates(relativePath)) {
      if (specs.length >= ADVISOR_LIMITS.maxSpecFiles) {break}
      const text = await this.files.read(candidate)
      if (text === undefined) {continue}
      const excerpt = clip(text, ADVISOR_LIMITS.excerptMaxChars)
      if (excerpt.length > budget) {break}
      budget -= excerpt.length
      specs.push({ path: candidate, excerpt })
    }

    const callers = unique(this.index.incomingDependencies(relativePath).map(edge => edge.fromPath))
      .filter(path => path !== relativePath)
      .sort()
      .slice(0, ADVISOR_LIMITS.maxCallers)

    const conventions = this.catalog.listProjectInstances()
      .slice(0, ADVISOR_LIMITS.maxConventions)
      .map(instance => {
        const methods = instance.publicMethods.slice(0, 6).join(', ')
        return `${instance.name} (${instance.filePath})${methods ? `: ${methods}` : ''}`
      })

    return { primaryPath: relativePath, primarySource, related: relatedKept, specs, callers, conventions }
  }

  /**
   * Files that define the constants the target references, most-referenced first. A primary file
   * that defines a constant is not related to itself, so it is excluded.
   */
  private async relatedFiles(
    primaryPath: string,
    targetText: string,
  ): Promise<Array<{ path: string; content: string; referencedAs: string[] }>> {
    const counts = new Map<string, number>()
    for (const match of targetText.matchAll(CONSTANT_REF)) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
    }
    const names = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_CONSTANTS_LOOKED_UP)
      .map(([name]) => name)

    const referencedBy = new Map<string, string[]>()
    for (const name of names) {
      for (const file of this.index.findDefiningFiles(name)) {
        if (file.relativePath === primaryPath) {continue}
        const list = referencedBy.get(file.relativePath) ?? []
        if (!list.includes(name)) {list.push(name)}
        referencedBy.set(file.relativePath, list)
      }
    }

    const ranked = [...referencedBy.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .slice(0, ADVISOR_LIMITS.maxRelatedFiles)

    const loaded: Array<{ path: string; content: string; referencedAs: string[] }> = []
    for (const [path, referencedAs] of ranked) {
      const content = await this.files.read(path)
      if (content !== undefined) {loaded.push({ path, content, referencedAs })}
    }
    return loaded
  }
}

/** Clips an excerpt and says how much was dropped, so the model never mistakes a cut file for a whole one. */
export function clip(text: string, max: number): string {
  if (text.length <= max) {return text}
  return `${text.slice(0, max)}\n# ...[truncated: ${text.length - max} more characters]`
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
