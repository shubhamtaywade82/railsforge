/**
 * RefactorAdvisor - the pure orchestrator. Two phases, each gated by validation:
 *
 *   suggest(target)  -> context -> prompt -> model -> parse -> validate paths -> suggestions
 *   plan(suggestion) -> current file text -> prompt -> model -> diff -> hunks applied to the
 *                       current text -> Ruby syntax check -> proposed file changes
 *
 * Nothing is written here. `plan` returns the exact file contents it would write; the VS Code layer
 * shows them as diffs and applies them only after the user confirms. A rejected model answer is
 * sent back once with the specific reason (`maxRepairRounds`), then reported.
 */

import { applyUnifiedHunks, UnifiedHunk } from '../../patch/UnifiedDiff'
import { ContextBuilder } from './ContextBuilder'
import { checkAdvisorPath } from './PathGuard'
import { ADVISOR_SYSTEM_PROMPT, buildAdvicePrompt, buildPlanPrompt, buildRepairSuffix } from './PromptBuilder'
import { parseAdvice, parseCodeDiff, RawSuggestion } from './ResponseParsers'
import {
  ADVISOR_LIMITS,
  AdvisorCatalog,
  AdvisorIndex,
  AdvisorModel,
  AdvisorResult,
  ProposedChange,
  ProposedPlan,
  RefactorSuggestion,
  RefactorTarget,
  SourceReader,
  SyntaxVerdict,
} from './types'

export interface AdvisorDeps {
  agent: AdvisorModel
  index: AdvisorIndex
  files: SourceReader
  catalog: AdvisorCatalog
  checkSyntax: (code: string) => Promise<SyntaxVerdict>
  log?: (message: string) => void
}

export class RefactorAdvisor {
  private readonly contextBuilder: ContextBuilder

  constructor(private readonly deps: AdvisorDeps) {
    this.contextBuilder = new ContextBuilder(deps.index, deps.files, deps.catalog)
  }

  /** Suggests refactorings for a target. An empty list means the code is already well designed. */
  async suggest(input: { relativePath: string; content: string; target: RefactorTarget }): Promise<AdvisorResult<RefactorSuggestion[]>> {
    const primary = checkAdvisorPath(input.relativePath)
    if (!primary.ok) {return { ok: false, reason: 'unsafe-path', message: primary.message }}

    const context = await this.contextBuilder.build({ ...input, relativePath: primary.path })
    const prompt = buildAdvicePrompt({
      relativePath: primary.path,
      target: input.target,
      context,
      patternNames: this.deps.catalog.listCatalog().map(entry => entry.name),
    })
    this.deps.log?.(`advisor: suggest ${primary.path} (${input.target.kind}, ${input.target.text.length} chars, ${context.related.length} related, ${context.specs.length} spec)`)
    return this.askWithRepair(prompt, text => this.validateAdvice(text))
  }

  /** Produces the exact file changes a suggestion would make, without writing anything. */
  async plan(suggestion: RefactorSuggestion): Promise<AdvisorResult<ProposedPlan>> {
    const files: Array<{ path: string; before: string | undefined }> = []
    let total = 0
    for (const raw of suggestion.files) {
      const guard = checkAdvisorPath(raw)
      if (!guard.ok) {return { ok: false, reason: 'unsafe-path', message: guard.message }}
      const before = await this.deps.files.read(guard.path)
      if (before !== undefined) {total += before.length}
      files.push({ path: guard.path, before })
    }

    if (total > ADVISOR_LIMITS.applyMaxChars) {
      return {
        ok: false,
        reason: 'too-large',
        message: `The files this suggestion changes total ${total} characters; the in-editor limit is ${ADVISOR_LIMITS.applyMaxChars}. Raise railsForge.ollama.numCtx for a local model, or make the change in chat.`,
      }
    }

    const prompt = buildPlanPrompt({ suggestion, files })
    this.deps.log?.(`advisor: plan "${suggestion.title}" over ${files.length} file(s), ${total} chars`)
    return this.askWithRepair(prompt, text => this.validatePlan(text, files))
  }

  private validateAdvice(text: string): AdvisorResult<RefactorSuggestion[]> {
    const parsed = parseAdvice(text)
    if (!parsed.ok) {return { ok: false, reason: 'invalid-response', message: parsed.message }}

    const suggestions: RefactorSuggestion[] = []
    let rejectedFiles = 0
    for (const raw of parsed.value) {
      const files = this.usableFiles(raw, () => { rejectedFiles++ })
      if (files === undefined) {continue}
      suggestions.push(toSuggestion(raw, files, `s${suggestions.length + 1}`))
    }

    if (parsed.value.length > 0 && suggestions.length === 0) {
      return {
        ok: false,
        reason: 'unsafe-path',
        message: 'None of the suggestions named a usable file. Use files from CONTEXT, or new .rb files under app/, lib/, spec/ or test/.',
      }
    }
    this.deps.log?.(`advisor: ${suggestions.length} suggestion(s), ${rejectedFiles} file path(s) rejected`)
    return { ok: true, value: suggestions.slice(0, ADVISOR_LIMITS.maxSuggestions) }
  }

  /** Returns the suggestion's paths that pass PathGuard, or undefined when the suggestion is unusable. */
  private usableFiles(raw: RawSuggestion, onRejected: () => void): string[] | undefined {
    const files: string[] = []
    for (const file of raw.files) {
      const guard = checkAdvisorPath(file)
      if (!guard.ok) {
        onRejected()
        continue
      }
      if (!files.includes(guard.path)) {files.push(guard.path)}
    }
    if (files.length === 0 || files.length > ADVISOR_LIMITS.maxFilesPerSuggestion) {
      onRejected()
      return undefined
    }
    return files
  }

  private async validatePlan(
    text: string,
    files: ReadonlyArray<{ path: string; before: string | undefined }>,
  ): Promise<AdvisorResult<ProposedPlan>> {
    const hunks = parseCodeDiff(text)
    if (!hunks) {
      return {
        ok: false,
        reason: 'invalid-response',
        message: 'The answer contained no valid unified diff. Output only a unified diff with --- and +++ headers and @@ hunks.',
      }
    }

    const allowed = new Set(files.map(f => f.path))
    const byPath = new Map<string, UnifiedHunk[]>()
    for (const hunk of hunks) {
      if (hunk.file === null) {
        return { ok: false, reason: 'invalid-response', message: 'A hunk has no "+++ b/<path>" header.' }
      }
      const guard = checkAdvisorPath(hunk.file)
      if (!guard.ok) {return { ok: false, reason: 'unsafe-path', message: guard.message }}
      if (!allowed.has(guard.path)) {
        return {
          ok: false,
          reason: 'file-not-allowed',
          message: `${guard.path} is not one of the files this suggestion may change (${[...allowed].join(', ')}).`,
        }
      }
      const list = byPath.get(guard.path) ?? []
      list.push(hunk)
      byPath.set(guard.path, list)
    }

    const changes: ProposedChange[] = []
    for (const file of files) {
      const fileHunks = byPath.get(file.path)
      if (!fileHunks) {continue}

      if (file.before === undefined) {
        if (fileHunks.some(h => h.oldLines.length > 0)) {
          return {
            ok: false,
            reason: 'file-missing',
            message: `${file.path} does not exist yet, so its hunks may only add lines (use --- /dev/null).`,
          }
        }
        const after = fileHunks.flatMap(h => h.newLines).join('\n') + '\n'
        if (after.trim() === '') {
          return { ok: false, reason: 'invalid-response', message: `${file.path} would be created empty.` }
        }
        changes.push({ path: file.path, kind: 'create', before: undefined, after })
        continue
      }

      if (fileHunks.some(h => h.oldLines.length === 0)) {
        // Every hunk without old lines is a "create this file" diff aimed at a file that already exists.
        const creating = fileHunks.every(h => h.oldLines.length === 0)
        return creating
          ? {
            ok: false,
            reason: 'file-exists',
            message: `${file.path} already exists. Change it with context and removed lines copied from its current text, not with --- /dev/null.`,
          }
          : {
            ok: false,
            reason: 'hunk-mismatch',
            message: `A hunk for ${file.path} has no context lines. Include three unchanged lines around each change, copied from CURRENT FILES.`,
          }
      }
      const applied = applyUnifiedHunks(file.before, fileHunks)
      if (!applied.ok) {
        return {
          ok: false,
          reason: 'hunk-mismatch',
          message: `${file.path}: ${applied.reason}. Copy context and removed lines exactly from CURRENT FILES.`,
        }
      }
      if (applied.text === file.before) {continue}
      changes.push({ path: file.path, kind: 'modify', before: file.before, after: applied.text })
    }

    if (changes.length === 0) {
      return { ok: false, reason: 'no-change', message: 'The diff does not change any file.' }
    }

    let syntaxUnverified = false
    for (const change of changes) {
      const verdict = await this.deps.checkSyntax(change.after)
      if (verdict.status === 'error') {
        return {
          ok: false,
          reason: 'syntax-error',
          message: `${change.path} would not parse as Ruby: ${firstLine(verdict.message)}. Fix the diff so every changed file is valid Ruby.`,
        }
      }
      if (verdict.status === 'unavailable') {syntaxUnverified = true}
    }
    return { ok: true, value: { changes, syntaxUnverified } }
  }

  /**
   * One model call, validated. On rejection the prompt is re-sent once with the reason attached.
   * A provider failure is not retried: it is reported as-is.
   */
  private async askWithRepair<T>(
    prompt: string,
    validate: (text: string) => AdvisorResult<T> | Promise<AdvisorResult<T>>,
  ): Promise<AdvisorResult<T>> {
    let current = prompt
    for (let attempt = 0; ; attempt++) {
      const reply = await this.deps.agent.run(current, { isolated: true, isolatedSystemPrompt: ADVISOR_SYSTEM_PROMPT })
      if (!reply.success) {
        this.deps.log?.(`advisor: model call failed: ${firstLine(reply.response)}`)
        return { ok: false, reason: 'model-unavailable', message: reply.response || 'The AI provider did not answer.' }
      }

      const verdict = await validate(reply.response)
      if (verdict.ok) {return verdict}

      this.deps.log?.(`advisor: answer rejected on attempt ${attempt + 1} (${verdict.reason}): ${verdict.message}`)
      if (attempt >= ADVISOR_LIMITS.maxRepairRounds) {return verdict}
      current = prompt + buildRepairSuffix(verdict.message, reply.response)
    }
  }
}

function toSuggestion(raw: RawSuggestion, files: string[], id: string): RefactorSuggestion {
  return {
    id,
    title: raw.title.slice(0, 120),
    pattern: raw.pattern,
    principle: raw.principle,
    impact: raw.impact,
    rationale: raw.rationale,
    files,
    steps: raw.steps.slice(0, 8),
  }
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trim().slice(0, 300)
}
