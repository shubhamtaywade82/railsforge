/**
 * ProjectPatternIndexer - Indexes this project's own Service/Query/Form/Policy/Decorator
 * classes so the developer (and the @rails agent) can find "how we did this here" before
 * writing something new, instead of opening several files or reinventing a pattern.
 */

export type PatternType = 'service' | 'query' | 'form' | 'policy' | 'decorator' | 'concern'

export interface IndexedPattern {
  id: string
  type: PatternType
  name: string
  filePath: string
  lineStart: number
  superclass?: string
  publicMethods: string[]
  preview: string
}

// Matched anywhere in the path, not just under app/, so a gem's lib/mygem/services/*.rb
// (a common convention for standalone Ruby gems that don't have a Rails `app/` directory)
// is indexed the same way app/services/*.rb is.
const DIR_TYPE_MAP: Array<{ segment: string; type: PatternType }> = [
  { segment: '/services/', type: 'service' },
  { segment: '/queries/', type: 'query' },
  { segment: '/forms/', type: 'form' },
  { segment: '/policies/', type: 'policy' },
  { segment: '/decorators/', type: 'decorator' },
  { segment: '/concerns/', type: 'concern' },
]

/** Instance methods Ruby makes private by default (Object#initialize and its copy hooks, respond_to_missing?). */
const ALWAYS_PRIVATE_METHODS: ReadonlySet<string> = new Set(['initialize', 'initialize_copy', 'initialize_clone', 'initialize_dup', 'respond_to_missing?'])

export class ProjectPatternIndexer {
  private patterns: Map<string, IndexedPattern> = new Map()

  indexFile(filePath: string, content: string): void {
    const type = this.classifyPath(filePath)
    if (!type) {return}
    this.indexFileAs(filePath, content, type)
  }

  /**
   * Same as `indexFile`, but the caller supplies `type` directly instead of it being
   * derived from `filePath` via `classifyPath`/`DIR_TYPE_MAP`. For a caller that already
   * knows the type from context — e.g. scanning a project's own differently-named
   * directory (`app/operations` instead of `app/services`) for pattern inference, where
   * the path wouldn't match any DIR_TYPE_MAP segment on its own.
   */
  indexFileAs(filePath: string, content: string, type: PatternType): void {
    this.removeFile(filePath)

    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const classMatch = /^\s*class\s+([A-Z][\w:]*)\s*(?:<\s*([A-Z][\w:]*))?/.exec(lines[i])
      if (!classMatch) {continue}

      const [, name, superclass] = classMatch
      const publicMethods = this.extractPublicMethods(lines, i)
      const preview = lines.slice(i, Math.min(lines.length, i + 6)).join('\n')

      const pattern: IndexedPattern = {
        id: `${filePath}::${name}`,
        type,
        name,
        filePath,
        lineStart: i + 1,
        superclass,
        publicMethods,
        preview,
      }
      this.patterns.set(pattern.id, pattern)
    }
  }

  removeFile(filePath: string): void {
    for (const [id, pattern] of this.patterns) {
      if (pattern.filePath === filePath) {
        this.patterns.delete(id)
      }
    }
  }

  classifyPath(filePath: string): PatternType | undefined {
    const normalized = filePath.replace(/\\/g, '/')
    return DIR_TYPE_MAP.find(entry => normalized.includes(entry.segment))?.type
  }

  getAllPatterns(): IndexedPattern[] {
    return Array.from(this.patterns.values())
  }

  getPatternsByType(type: PatternType): IndexedPattern[] {
    return this.getAllPatterns().filter(p => p.type === type)
  }

  findPatternAt(filePath: string, line: number): IndexedPattern | undefined {
    return this.getAllPatterns().find(p => p.filePath === filePath && p.lineStart === line)
  }

  /**
   * Ranks existing patterns of the same type by name + method-name overlap, so
   * "3 similar services" points at the closest real prior art, not just any file.
   */
  findSimilar(pattern: IndexedPattern, limit = 3): IndexedPattern[] {
    return this.getPatternsByType(pattern.type)
      .filter(p => p.id !== pattern.id)
      .map(p => ({ pattern: p, score: this.similarityScore(pattern, p) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(entry => entry.pattern)
  }

  private similarityScore(a: IndexedPattern, b: IndexedPattern): number {
    const nameScore = this.tokenOverlap(this.tokenizeName(a.name), this.tokenizeName(b.name)) * 2
    const methodScore = this.tokenOverlap(a.publicMethods, b.publicMethods)
    const superclassScore = a.superclass && a.superclass === b.superclass ? 1 : 0
    return nameScore + methodScore + superclassScore
  }

  private tokenizeName(name: string): string[] {
    return name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[\s_]+/)
      .map(t => t.toLowerCase())
      .filter(Boolean)
  }

  private tokenOverlap(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) {return 0}
    const setB = new Set(b)
    const shared = a.filter(t => setB.has(t)).length
    return shared / Math.max(a.length, b.length)
  }

  private extractPublicMethods(lines: string[], classLine: number): string[] {
    const methods: string[] = []
    let depth = 0
    let sawPrivate = false

    for (let i = classLine + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim()

      if (trimmed === 'end' || /^end\b/.test(trimmed)) {
        if (depth === 0) {break}
        depth--
        continue
      }

      if (depth === 0) {
        if (trimmed === 'private' || trimmed === 'protected') {
          sawPrivate = true
          continue
        }
        const defMatch = /^def\s+(?:self\.)?([a-zA-Z0-9_?!=]+)/.exec(trimmed)
        if (defMatch) {
          const isEndlessMethod = /\)\s*=(?!=|>)/.test(trimmed) || /^def\s+\S+\s*=(?!=|>)/.test(trimmed)
          // Ruby makes these instance methods private whatever the enclosing visibility keyword says.
          const alwaysPrivate = !/^def\s+self\./.test(trimmed) && ALWAYS_PRIVATE_METHODS.has(defMatch[1])
          if (!sawPrivate && !alwaysPrivate) {methods.push(defMatch[1])}
          if (!isEndlessMethod) {depth++}
          continue
        }
      }

      if (this.opensBlock(trimmed)) {
        depth++
      }
    }

    return methods
  }

  private opensBlock(trimmed: string): boolean {
    if (/^(class|module|if|unless|case|while|until|begin)\b/.test(trimmed)) {return true}
    if (/\bdo(\s*\|[^|]*\|)?\s*$/.test(trimmed)) {return true}
    return false
  }
}
