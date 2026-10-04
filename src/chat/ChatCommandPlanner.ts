/**
 * ChatCommandPlanner - gives each `@rails /command` its own workflow.
 *
 * Every command first gathers the evidence it needs deterministically (static analysis,
 * schema, diagnostics, existing patterns) and then produces (a) a markdown preface shown
 * to the user and (b) a command-specific directive prepended to the LLM prompt. No vscode
 * dependency, so each strategy is unit-testable.
 */

import { analyzeNPlusOne, SchemaLike } from '../rails/NPlusOneAnalyzer'
import { StrongMigrationsAnalyzer } from '../rails/StrongMigrationsAnalyzer'

export interface ChatCommandInput {
  prompt: string
  fileName?: string
  fileContent?: string
  selection?: string
  tables: readonly SchemaLike[]
  testFramework: 'rspec' | 'minitest'
  /** Diagnostic messages (with 1-based line) currently reported for the active file. */
  diagnostics: ReadonlyArray<{ line: number; message: string }>
  /** `type/Name` entries from the project pattern index. */
  patterns: readonly string[]
}

export interface ChatCommandPlan {
  /** Markdown streamed to the user before the model answers. */
  preface: string
  /** Prepended to the user's prompt for the model. */
  directive: string
}

export const CHAT_COMMANDS = ['explain', 'fix', 'service', 'scaffold', 'spec', 'optimize', 'migrate'] as const
export type ChatCommandName = (typeof CHAT_COMMANDS)[number]

const MAX_LIST = 15

function targetCode(input: ChatCommandInput): string {
  return input.selection?.trim() ? input.selection : (input.fileContent ?? '')
}

function list(items: readonly string[]): string {
  const shown = items.slice(0, MAX_LIST).join(', ')
  return items.length > MAX_LIST ? `${shown}, … (+${items.length - MAX_LIST})` : shown
}

function planExplain(): ChatCommandPlan {
  return {
    preface: '',
    directive: 'COMMAND /explain: Explain the provided code (associations, queries, callbacks, control flow). This is READ-ONLY: do not propose changes or output a diff unless asked.',
  }
}

function planFix(input: ChatCommandInput): ChatCommandPlan {
  if (input.diagnostics.length === 0) {
    return {
      preface: '_No diagnostics reported for the active file; fixing based on your description._\n\n',
      directive: 'COMMAND /fix: Diagnose and fix the problem the user describes. Output a minimal unified diff against the provided file.',
    }
  }
  const shown = input.diagnostics.slice(0, MAX_LIST).map(d => `- line ${d.line}: ${d.message}`).join('\n')
  return {
    preface: `### Active diagnostics\n${shown}\n\n`,
    directive: `COMMAND /fix: Fix these diagnostics reported for the active file, changing only what each requires. Output a minimal unified diff.\nDiagnostics:\n${shown}`,
  }
}

function planService(input: ChatCommandInput): ChatCommandPlan {
  const services = input.patterns.filter(p => p.startsWith('service/')).map(p => p.slice('service/'.length))
  const note = services.length > 0
    ? `Existing services: ${list(services)}. Reuse or extend a close match instead of duplicating it.`
    : 'No existing services indexed.'
  return {
    preface: `### Service Object\n${note}\n\n`,
    directive: `COMMAND /service: Produce a Service Object under app/services with a single public \`call\` method, constructor-injected dependencies and an explicit result. ${note} Output the full new file; do not modify unrelated files.`,
  }
}

function planScaffold(input: ChatCommandInput): ChatCommandPlan {
  const tables = input.tables.map(t => t.name)
  return {
    preface: `### Scaffold\nExisting tables (${tables.length}): ${tables.length ? list(tables) : 'none indexed'}.\n\n`,
    directive: `COMMAND /scaffold: Generate a model, a reversible migration and a controller following Rails conventions. Existing tables: ${tables.join(', ') || 'none'} — do NOT recreate any of them; add foreign keys and indexes only to tables listed here. Present each file under its own path heading.`,
  }
}

function planSpec(input: ChatCommandInput): ChatCommandPlan {
  const fw = input.testFramework === 'rspec' ? 'RSpec' : 'Minitest'
  return {
    preface: `### Tests\nFramework detected from Gemfile.lock: **${fw}**.\n\n`,
    directive: `COMMAND /spec: Write ${fw} tests for the provided code — happy path, edge cases and failure cases. Use ONLY ${fw}; do not mix frameworks. Output the full test file.`,
  }
}

function planOptimize(input: ChatCommandInput): ChatCommandPlan {
  const code = targetCode(input)
  const findings = analyzeNPlusOne(code, input.tables)
  if (findings.length === 0) {
    return {
      preface: `### N+1 analysis\nNo N+1 candidates found by static analysis in ${input.selection?.trim() ? 'the selection' : 'the active file'} (${input.tables.length} schema tables considered).\n\n`,
      directive: 'COMMAND /optimize: Static analysis found NO N+1 candidates. Review the code for other query inefficiencies (missing indexes, count vs size, loading whole tables, pluck/select) and do NOT invent N+1 problems that are not present.',
    }
  }
  const lines = findings.map(f => `- line ${f.line}: \`${f.collection}\` iterates as \`${f.variable}\` and calls \`${f.variable}.${f.association}\` (line ${f.accessLine}) with no eager loading`)
  return {
    preface: `### N+1 candidates (static analysis — verify before changing)\n${lines.join('\n')}\n\n`,
    directive: `COMMAND /optimize: Static analysis found these N+1 CANDIDATES. Confirm each against the schema/models, then fix only the confirmed ones with includes/preload/eager_load on the iterated relation. Say explicitly if a candidate is a false positive.\n${lines.join('\n')}`,
  }
}

function planMigrate(input: ChatCommandInput): ChatCommandPlan {
  const code = targetCode(input)
  const isMigration = /\bclass\s+\w+\s*<\s*ActiveRecord::Migration/.test(code)
  const dangers = isMigration ? new StrongMigrationsAnalyzer().analyzeMigration(code) : []
  const tables = input.tables.map(t => t.name)
  const dangerLines = dangers.map(d => `- [${d.severity}] line ${d.line}: ${d.title} — ${d.recommendation}`)
  const preface = dangerLines.length > 0
    ? `### Migration safety issues in the active file\n${dangerLines.join('\n')}\n\n`
    : `### Migration\nExisting tables: ${tables.length ? list(tables) : 'none indexed'}.\n\n`
  const dangerDirective = dangerLines.length > 0
    ? `\nThe current migration has these zero-downtime hazards; the result must resolve them:\n${dangerLines.join('\n')}`
    : ''
  return {
    preface,
    directive: `COMMAND /migrate: Produce a safe, reversible ActiveRecord migration (explicit up/down or reversible blocks, concurrent indexes where applicable, no table-locking operations on large tables). Existing tables: ${tables.join(', ') || 'none'}.${dangerDirective}`,
  }
}

export function planChatCommand(command: string | undefined, input: ChatCommandInput): ChatCommandPlan {
  switch (command as ChatCommandName | undefined) {
    case 'explain': return planExplain()
    case 'fix': return planFix(input)
    case 'service': return planService(input)
    case 'scaffold': return planScaffold(input)
    case 'spec': return planSpec(input)
    case 'optimize': return planOptimize(input)
    case 'migrate': return planMigrate(input)
    default: return { preface: '', directive: '' }
  }
}

/** Final model prompt: directive first, then the user's own words. */
export function composePrompt(plan: ChatCommandPlan, userPrompt: string): string {
  return plan.directive ? `${plan.directive}\n\nUser request: ${userPrompt}` : userPrompt
}
