import { UnifiedHunk } from '../patch/UnifiedDiff'
import { RailsAgent, RailsAgentContext } from './RailsAgent'

export interface CachedFix {
  diff: string
  diagnosticMessage: string
  cop: string
  codePattern: string
  generatedAt: number
}

interface SpeculativeCacheConfig {
  maxEntries: number
  ttlMs: number
}

const DEFAULT_CONFIG: SpeculativeCacheConfig = {
  maxEntries: 100,
  ttlMs: 24 * 60 * 60 * 1000,
}

interface CopTemplate {
  cop: string
  codePattern: string
  prompt: string
}

const COMMON_COP_TEMPLATES: CopTemplate[] = [
  { cop: 'Style/FrozenStringLiteralComment', codePattern: '^\\s*[^#]', prompt: 'Fix missing frozen_string_literal comment. Output ONLY a minimal unified diff adding the comment.' },
  { cop: 'Style/Documentation', codePattern: 'class\\s+[A-Z]\\w*', prompt: 'Fix missing top-level doc comment. Output ONLY a minimal unified diff adding a comment line.' },
  { cop: 'Layout/TrailingWhitespace', codePattern: '\\s+$', prompt: 'Fix trailing whitespace. Output ONLY a minimal unified diff removing trailing spaces.' },
  { cop: 'Rails/ReadWriteAttribute', codePattern: 'attr_(reader|writer|accessor)\\s+:', prompt: 'Fix Rails attribute accessor. Output ONLY a minimal unified diff.' },
  { cop: 'Rails/SaveBang', codePattern: '\\.save(?!\\!)', prompt: 'Fix save call to use save!. Output ONLY a minimal unified diff.' },
  { cop: 'Style/StringLiterals', codePattern: '"[^"]*"', prompt: 'Fix string literal style. Output ONLY a minimal unified diff.' },
  { cop: 'Layout/LineLength', codePattern: '.{120,}', prompt: 'Fix line length violation. Output ONLY a minimal unified diff.' },
  { cop: 'Metrics/MethodLength', codePattern: 'def\\s+\\w+', prompt: 'Fix method length violation. Output ONLY a minimal unified diff.' },
  { cop: 'Metrics/ClassLength', codePattern: 'class\\s+[A-Z]\\w*', prompt: 'Fix class length violation. Output ONLY a minimal unified diff.' },
  { cop: 'Style/GuardClause', codePattern: 'if\\s+.*\\n\\s+else', prompt: 'Fix guard clause. Output ONLY a minimal unified diff.' },
  { cop: 'Rails/Pluck', codePattern: '\\.map\\{|\\.collect\\{', prompt: 'Fix to use pluck instead of map. Output ONLY a minimal unified diff.' },
  { cop: 'Rails/WhereExists', codePattern: '\\.where\\(.*\\.exists', prompt: 'Fix to use where.exists. Output ONLY a minimal unified diff.' },
  { cop: 'Rails/OutputSafety', codePattern: '<%=', prompt: 'Fix output safety. Output ONLY a minimal unified diff.' },
  { cop: 'Rails/Delegate', codePattern: 'def\\s+\\w+.*\\.\\w+', prompt: 'Fix to use delegate. Output ONLY a minimal unified diff.' },
  { cop: 'Style/EmptyMethod', codePattern: 'def\\s+\\w+\\s*\\(.*\\)\\s*\\n\\s*end', prompt: 'Fix empty method. Output ONLY a minimal unified diff.' },
  { cop: 'Style/RedundantReturn', codePattern: 'return\\s+', prompt: 'Fix redundant return. Output ONLY a minimal unified diff.' },
  { cop: 'Style/RedundantSelf', codePattern: 'self\\.\\w+', prompt: 'Fix redundant self. Output ONLY a minimal unified diff.' },
  { cop: 'Layout/SpaceAroundOperators', codePattern: '[^\\s][+\\-*/=]{1,2}[^\\s]', prompt: 'Fix spacing around operators. Output ONLY a minimal unified diff.' },
  { cop: 'Style/NumericLiterals', codePattern: '\\d{4,}', prompt: 'Fix numeric literals. Output ONLY a minimal unified diff.' },
  { cop: 'Style/PercentQLiterals', codePattern: '"\\[.*\\]"', prompt: 'Fix to use %q/%Q literal syntax. Output ONLY a minimal unified diff.' },
  { cop: 'Layout/FirstArrayElementIndentation', codePattern: '\\[\\s*\\n', prompt: 'Fix array element indentation. Output ONLY a minimal unified diff.' },
]

export class SpeculativeFixCache {
  private cache = new Map<string, CachedFix>()
  private agent: RailsAgent
  private config: SpeculativeCacheConfig
  private warming: Promise<void> | null = null
  private warmed = false

  constructor(agent: RailsAgent, config?: Partial<SpeculativeCacheConfig>) {
    this.agent = agent
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async warm(): Promise<void> {
    if (this.warmed) { return }
    if (this.warming) { return this.warming }

    this.warming = this.doWarm()
    try {
      await this.warming
      this.warmed = true
    } finally {
      this.warming = null
    }
  }

  private async doWarm(): Promise<void> {
    for (const template of COMMON_COP_TEMPLATES) {
      if (this.cache.size >= this.config.maxEntries) { break }
      try {
        const diff = await this.generateTemplateFix(template)
        if (diff) {
          this.set(template.cop, template.codePattern, diff)
        }
      } catch {
        // Speculative pre-warming is best-effort on activation
      }
    }
  }

  private async generateTemplateFix(template: CopTemplate): Promise<string | null> {
    const exampleCode = this.getExampleCode(template.cop)
    if (!exampleCode) { return null }

    const context: RailsAgentContext = {
      fileContent: exampleCode,
      fileName: `example_${template.cop.replace(/\//g, '_')}.rb`,
      diagnosticMessage: template.cop,
      isFix: true,
    }

    const result = await this.agent.suggestFix(exampleCode, `${template.cop}. ${template.prompt}`, context)
    if (!result || result.type !== 'patch' || result.hunks.length === 0) { return null }

    return this.hunksToDiff(result.hunks)
  }

  private getExampleCode(cop: string): string | null {
    const examples: Record<string, string> = {
      'Style/FrozenStringLiteralComment': 'class Foo\n  def bar; end\nend',
      'Style/Documentation': 'class Foo\n  def bar; end\nend',
      'Layout/TrailingWhitespace': 'class Foo\n  def bar\n    1 \n  end\nend',
      'Rails/ReadWriteAttribute': 'class Foo < ApplicationRecord\n  attr_reader :foo\nend',
      'Rails/SaveBang': 'class Foo < ApplicationRecord\n  def save_it\n    save\n  end\nend',
      'Style/StringLiterals': 'class Foo\n  def bar\n    "hello"\n  end\nend',
      'Layout/LineLength': 'class Foo\n  def bar\n    very_long_method_name_that_exceeds_the_maximum_line_length_allowed_by_rubocop\n  end\nend',
      'Metrics/MethodLength': 'class Foo\n  def very_long_method\n    1; 2; 3; 4; 5; 6; 7; 8; 9; 10\n  end\nend',
      'Metrics/ClassLength': 'class Foo\n  def m1; end; def m2; end; def m3; end; def m4; end; def m5; end; def m6; end; def m7; end; def m8; end; def m9; end; def m10; end\nend',
      'Style/GuardClause': 'class Foo\n  def bar\n    if condition\n      do_something\n    else\n      do_other\n    end\n  end\nend',
      'Rails/Pluck': 'class Foo < ApplicationRecord\n  def bar\n    User.all.map(&:name)\n  end\nend',
      'Rails/WhereExists': 'class Foo < ApplicationRecord\n  def bar\n    User.where(posts: { exists: true })\n  end\nend',
      'Rails/OutputSafety': '<%= @user.name %>',
      'Rails/Delegate': 'class Foo < ApplicationRecord\n  def bar\n    user.name\n  end\nend',
      'Style/EmptyMethod': 'class Foo\n  def bar\n  end\nend',
      'Style/RedundantReturn': 'class Foo\n  def bar\n    return 1\n  end\nend',
      'Style/RedundantSelf': 'class Foo\n  def bar\n    self.baz\n  end\nend',
      'Layout/SpaceAroundOperators': 'class Foo\n  def bar\n    1+2\n  end\nend',
      'Style/NumericLiterals': 'class Foo\n  def bar\n    1000000\n  end\nend',
      'Style/PercentQLiterals': 'class Foo\n  def bar\n    "hello"\n  end\nend',
      'Layout/FirstArrayElementIndentation': 'class Foo\n  def bar\n    [\n      1\n    ]\n  end\nend',
    }
    return examples[cop] ?? null
  }

  private hunksToDiff(hunks: UnifiedHunk[]): string {
    const hunk = hunks[0]
    if (!hunk) { return '' }
    const lines = ['--- a/example.rb', '+++ b/example.rb']
    lines.push(`@@ -${hunk.oldStart + 1},${hunk.oldLines.length} +${hunk.oldStart + 1},${hunk.newLines.length} @@`)
    for (let i = 0; i < Math.max(hunk.oldLines.length, hunk.newLines.length); i++) {
      if (i < hunk.oldLines.length && i < hunk.newLines.length) {
        if (hunk.oldLines[i] !== hunk.newLines[i]) {
          lines.push(`-${hunk.oldLines[i]}`)
          lines.push(`+${hunk.newLines[i]}`)
        } else {
          lines.push(` ${hunk.oldLines[i]}`)
        }
      } else if (i < hunk.oldLines.length) {
        lines.push(`-${hunk.oldLines[i]}`)
      } else {
        lines.push(`+${hunk.newLines[i]}`)
      }
    }
    return lines.join('\n')
  }

  private makeKey(cop: string, codePattern: string): string {
    return `${cop}:${codePattern}`
  }

  get(cop: string, code: string): string | null {
    const key = this.findMatchingKey(cop, code)
    if (!key) { return null }

    const entry = this.cache.get(key)
    if (!entry) { return null }

    // Evict expired entry when accessed
    if (Date.now() - entry.generatedAt > this.config.ttlMs) {
      this.cache.delete(key)
      return null
    }

    try {
      if (!new RegExp(entry.codePattern).test(code)) { return null }
    } catch {
      return null
    }

    return entry.diff
  }

  private findMatchingKey(cop: string, code: string): string | null {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.cop === cop) {
        try {
          if (new RegExp(entry.codePattern).test(code)) { return key }
        } catch {
          continue
        }
      }
    }
    return null
  }

  set(cop: string, codePattern: string, diff: string): void {
    if (this.cache.size >= this.config.maxEntries) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) { this.cache.delete(oldestKey) }
    }
    const key = this.makeKey(cop, codePattern)
    this.cache.set(key, {
      diff,
      diagnosticMessage: cop,
      cop,
      codePattern,
      generatedAt: Date.now(),
    })
  }

  clear(): void {
    this.cache.clear()
    this.warmed = false
    this.warming = null
  }

  stats(): { size: number; warmed: boolean; entries: string[] } {
    return {
      size: this.cache.size,
      warmed: this.warmed,
      entries: Array.from(this.cache.keys()),
    }
  }
}

/**
 * Wraps an AI fix handler so `cache.warm()` runs once the handler has settled, whether it succeeded or threw.
 *
 * Warm-up is one model request per template. A local model usually serves one request at a time, so warm-up
 * must not queue ahead of the user's own request: it starts only after that request has finished. `warm()` is
 * idempotent and coalesces concurrent calls, so calling it after every AI fix costs nothing once it has run.
 * `shouldWarm` lets the caller skip warm-up entirely (the extension skips it under the test host).
 */
export function warmAfter<A extends unknown[]>(
  cache: Pick<SpeculativeFixCache, 'warm'>,
  handler: (...args: A) => Promise<void>,
  shouldWarm: () => boolean = () => true,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await handler(...args)
    } finally {
      if (shouldWarm()) {
        // Per-template failures are already swallowed inside warm(); this only keeps a stray rejection from
        // becoming an unhandled one.
        cache.warm().catch(() => undefined)
      }
    }
  }
}
