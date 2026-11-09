/**
 * TargetResolver - decides what the advisor analyses, from a cursor or a selection. Pure: the
 * VS Code command passes plain 1-based line numbers.
 *
 * Resolution order:
 *   1. A non-empty selection  -> block (the selected lines, verbatim)
 *   2. Cursor inside a method -> method (innermost, by line span)
 *   3. Cursor inside a class or module -> class (innermost)
 *   4. Otherwise              -> refused. The advisor never guesses a scope.
 */

import { RubyAstParser, ParsedTypeDefinition } from '../../indexer/RubyAstParser'
import { ADVISOR_LIMITS, RefactorTarget } from './types'

/** 1-based inclusive line range. `isEmpty` means a bare cursor, not a selection. */
export interface SelectionLines {
  startLine: number
  endLine: number
  isEmpty: boolean
}

export type TargetResolution =
  | { ok: true; target: RefactorTarget }
  | { ok: false; message: string }

interface MethodSpan {
  name: string
  owner: string
  startLine: number
  endLine: number
}

export class TargetResolver {
  private cache: { content: string; types: ParsedTypeDefinition[] } | undefined

  constructor(private readonly parser: RubyAstParser = new RubyAstParser()) {}

  resolve(content: string, selection: SelectionLines): TargetResolution {
    const lines = content.split(/\r?\n/)
    const lastLine = Math.max(1, lines.length)
    const first = clamp(Math.min(selection.startLine, selection.endLine), 1, lastLine)
    const last = clamp(Math.max(selection.startLine, selection.endLine), 1, lastLine)

    const types = this.types(content)
    const methods = this.methodSpans(types)
    const enclosingMethod = innermost(methods.filter(m => contains(m, first)))
    const enclosingType = innermost(types.filter(t => contains(t, first)))

    if (!selection.isEmpty) {
      const text = lines.slice(first - 1, last).join('\n')
      if (text.trim() === '') {
        return { ok: false, message: 'The selection is blank. Select the code you want to refactor.' }
      }
      if (text.length > ADVISOR_LIMITS.targetMaxChars) {
        return { ok: false, message: tooLarge('The selection', text.length) }
      }
      return {
        ok: true,
        target: {
          kind: 'block',
          name: `lines ${first}-${last}`,
          startLine: first,
          endLine: last,
          text,
          enclosingClass: enclosingType?.name,
          enclosingMethod: enclosingMethod?.name,
        },
      }
    }

    if (enclosingMethod) {
      const text = lines.slice(enclosingMethod.startLine - 1, enclosingMethod.endLine).join('\n')
      if (text.length > ADVISOR_LIMITS.targetMaxChars) {
        return { ok: false, message: tooLarge(`Method ${enclosingMethod.name}`, text.length) }
      }
      return {
        ok: true,
        target: {
          kind: 'method',
          name: enclosingMethod.name,
          className: enclosingMethod.owner,
          startLine: enclosingMethod.startLine,
          endLine: enclosingMethod.endLine,
          text,
        },
      }
    }

    if (enclosingType) {
      const text = lines.slice(enclosingType.startLine - 1, enclosingType.endLine).join('\n')
      if (text.length > ADVISOR_LIMITS.targetMaxChars) {
        return { ok: false, message: tooLarge(`${enclosingType.kind === 'module' ? 'Module' : 'Class'} ${enclosingType.name}`, text.length) }
      }
      return {
        ok: true,
        target: { kind: 'class', name: enclosingType.name, startLine: enclosingType.startLine, endLine: enclosingType.endLine, text },
      }
    }

    return { ok: false, message: 'Put the cursor inside a class, module or method, or select the code to refactor.' }
  }

  private types(content: string): ParsedTypeDefinition[] {
    if (this.cache?.content !== content) {
      this.cache = { content, types: this.parser.parseTypeDefinitions(content) }
    }
    return this.cache.types
  }

  private methodSpans(types: readonly ParsedTypeDefinition[]): MethodSpan[] {
    return types.flatMap(type => type.methods.map(method => ({
      name: method.name,
      owner: type.name,
      startLine: method.startLine,
      endLine: method.endLine,
    })))
  }
}

function contains(span: { startLine: number; endLine: number }, line: number): boolean {
  return span.startLine <= line && line <= span.endLine
}

/** The narrowest span wins: an inner method or nested class beats the one that encloses it. */
function innermost<T extends { startLine: number; endLine: number }>(spans: readonly T[]): T | undefined {
  let best: T | undefined
  for (const span of spans) {
    if (!best || span.endLine - span.startLine < best.endLine - best.startLine) {best = span}
  }
  return best
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max)
}

function tooLarge(subject: string, chars: number): string {
  return `${subject} is ${chars} characters; the advisor accepts up to ${ADVISOR_LIMITS.targetMaxChars}. Put the cursor on a method or select a smaller block.`
}

/** Same label the rest of the pipeline uses ("method Order#total", "class Order", "lines 12-30"). */
export { describeScope as describeTarget } from './types'
