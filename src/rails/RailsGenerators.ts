/**
 * RailsGenerators - catalog, argument validation/building and output parsing for
 * `rails generate` / `rails destroy`. Pure (no vscode/child_process) so it is unit-testable.
 * Arguments are always passed as an argv array, never through a shell.
 */

export interface GeneratorKind {
  id: string
  label: string
  description: string
  /** Whether the generator takes `name:type` attribute arguments. */
  takesAttributes: boolean
  namePrompt: string
}

export const GENERATORS: readonly GeneratorKind[] = [
  { id: 'model', label: 'Model', description: 'Model + migration + test', takesAttributes: true, namePrompt: 'Model name (e.g. User)' },
  { id: 'migration', label: 'Migration', description: 'e.g. AddEmailToUsers email:string', takesAttributes: true, namePrompt: 'Migration name (e.g. AddEmailToUsers)' },
  { id: 'controller', label: 'Controller', description: 'Controller + views + test (name then actions)', takesAttributes: true, namePrompt: 'Controller name (e.g. Users) — actions go in the next step' },
  { id: 'resource', label: 'Resource', description: 'Model, migration, controller, routes', takesAttributes: true, namePrompt: 'Resource name (e.g. Post)' },
  { id: 'scaffold', label: 'Scaffold', description: 'Full CRUD scaffold', takesAttributes: true, namePrompt: 'Scaffold name (e.g. Post)' },
  { id: 'job', label: 'Job', description: 'ActiveJob job', takesAttributes: false, namePrompt: 'Job name (e.g. Cleanup)' },
  { id: 'mailer', label: 'Mailer', description: 'ActionMailer mailer (name then actions)', takesAttributes: true, namePrompt: 'Mailer name (e.g. User)' },
  { id: 'channel', label: 'Channel', description: 'ActionCable channel', takesAttributes: true, namePrompt: 'Channel name (e.g. Chat)' },
  { id: 'helper', label: 'Helper', description: 'View helper', takesAttributes: false, namePrompt: 'Helper name (e.g. Users)' },
  { id: 'stimulus', label: 'Stimulus controller', description: 'Hotwire Stimulus controller', takesAttributes: false, namePrompt: 'Controller name (e.g. clipboard)' },
]

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*(?:(?:::|\/)[A-Za-z][A-Za-z0-9_]*)*$/
const ATTRIBUTE_RE = /^[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z0-9_{},]+)*[!^#]?$/

export function validateGeneratorName(name: string): string | undefined {
  return NAME_RE.test(name.trim()) ? undefined : 'Use letters, digits and underscores, optionally namespaced with :: or /'
}

/** Splits "name:string email:string:index" into validated tokens; returns an error message for a bad token. */
export function parseAttributes(input: string): { attributes: string[] } | { error: string } {
  const tokens = input.trim().split(/\s+/).filter(Boolean)
  for (const token of tokens) {
    if (!ATTRIBUTE_RE.test(token)) {return { error: `Invalid attribute "${token}" (expected name:type, e.g. email:string:index)` }}
  }
  return { attributes: tokens }
}

export type GeneratorMode = 'generate' | 'destroy'

export function buildGeneratorArgs(mode: GeneratorMode, kind: string, name: string, attributes: readonly string[], extra: readonly string[] = []): string[] {
  return [mode, kind, name.trim(), ...attributes, ...extra]
}

export interface GeneratorOutput {
  created: string[]
  modified: string[]
  removed: string[]
  conflicts: string[]
  skipped: string[]
}

const STATUS_RE = /^\s*(create|identical|skip|conflict|force|remove|insert|gsub|append|prepend|route|rake|migrate)\s+(\S.*?)\s*$/

/** Parses the status column of generator output (`      create  app/models/user.rb`). */
export function parseGeneratorOutput(output: string): GeneratorOutput {
  const result: GeneratorOutput = { created: [], modified: [], removed: [], conflicts: [], skipped: [] }
  for (const line of output.split('\n')) {
    const m = STATUS_RE.exec(line)
    if (!m) {continue}
    const [, status, target] = m
    switch (status) {
      case 'create':
      case 'force': result.created.push(target); break
      case 'insert':
      case 'gsub':
      case 'append':
      case 'prepend':
      case 'route': result.modified.push(target); break
      case 'remove': result.removed.push(target); break
      case 'conflict': result.conflicts.push(target); break
      case 'identical':
      case 'skip': result.skipped.push(target); break
      default: break // rake / migrate lines carry task names, not files
    }
  }
  return result
}
