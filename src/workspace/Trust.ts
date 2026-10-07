/**
 * Trust - the single place that decides whether RailsForge may execute project code.
 *
 * In an untrusted workspace (VS Code "Restricted Mode") RailsForge keeps every read-only feature (parsing
 * schema/routes/source, navigation, the semantic graph, pattern catalog, AI chat over what it can read) but
 * must not run anything the workspace controls: `bundle exec` (evaluates the Gemfile), RuboCop (loads
 * `require:` files from .rubocop.yml), rake, rails, test runners, debuggers or terminals.
 *
 * Every process launch goes through ProjectProcess.ts and every terminal write through ProjectTerminal.ts, both
 * of which call assertTrusted(). vscode-free: the extension injects the real provider at activation.
 * Standalone use (the MCP server, unit tests) defaults to trusted because it never launches project processes.
 */

export class UntrustedWorkspaceError extends Error {
  readonly code = 'RAILSFORGE_UNTRUSTED_WORKSPACE'
  constructor(readonly action: string) {
    super(`RailsForge: "${action}" runs project code, which is disabled in Restricted Mode. Trust this workspace to enable it.`)
    this.name = 'UntrustedWorkspaceError'
  }
}

export type TrustProvider = () => boolean

let provider: TrustProvider = () => true
let onBlocked: ((action: string) => void) | undefined

/** Installs the trust source (VS Code's `workspace.isTrusted`); returns the previous one (tests restore it). */
export function setTrustProvider(next: TrustProvider): TrustProvider {
  const previous = provider
  provider = next
  return previous
}

/** Called whenever an action is refused (logging); must not throw. */
export function setBlockedListener(listener: ((action: string) => void) | undefined): void {
  onBlocked = listener
}

export function isWorkspaceTrusted(): boolean {
  try {
    return provider()
  } catch {
    return false // fail closed: if trust cannot be determined, nothing executes
  }
}

export function assertTrusted(action: string): void {
  if (isWorkspaceTrusted()) {return}
  try { onBlocked?.(action) } catch { /* a logging failure must never turn a refusal into an execution */ }
  throw new UntrustedWorkspaceError(action)
}

/**
 * Commands that execute project code (processes, terminals, debuggers). They are declared
 * `"enablement": "isWorkspaceTrusted"` in package.json (checked by a test) and are additionally
 * refused at the process/terminal layer.
 */
export const TRUST_GATED_COMMANDS: readonly string[] = [
  'railsforge.releaseGem',
  'railsforge.runBrakeman',
  'railsforge.runBundleAudit',
  'railsforge.rubocopAutocorrect',
  'railsforge.runAnalyzers',
  'railsforge.generate',
  'railsforge.destroyGenerated',
  'railsforge.refreshRuntimeIntrospection',
  'railsforge.openRailsConsole',
  'railsforge.evaluateInREPL',
  'railsforge.runSteepCheck',
  'railsforge.generateRBS',
  'railsforge.refreshRakeTasks',
  'railsforge.fixAllInFile',
]
