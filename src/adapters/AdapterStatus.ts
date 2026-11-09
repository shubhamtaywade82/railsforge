/**
 * AdapterStatus - turns what RailsForge can observe about one optional tool into a state, and decides whether to
 * ask the user about it. Pure: the probes that answer "is it installed globally" live in AdapterProbe.ts.
 *
 * A project gem is recognised from Gemfile.lock alone, which runs no code. Global installs need a probe.
 * When a probe cannot answer (untrusted workspace, missing toolchain, failed command), the state is `unknown`,
 * never `missing`. RailsForge must not ask someone to install a tool it could not check.
 *
 * vscode-free.
 */

import type { AdapterEntry } from './AdapterCatalog'

export type AdapterState =
  | { kind: 'installed'; where: 'project' | 'global'; version?: string }
  | { kind: 'missing' }
  | { kind: 'toolchain-missing'; tool: 'gem' | 'npm' }
  | { kind: 'ruby-too-old'; detected: string; required: string }
  | { kind: 'unknown'; reason: 'untrusted' | 'probe-failed' }

/** The answer from a global probe. `found` is null when the question could not be answered. */
export interface GlobalProbe {
  found: boolean | null
  version?: string
  reason?: 'untrusted' | 'toolchain-missing' | 'probe-failed'
}

/** Compares dotted numeric versions. Missing parts count as zero, and non-numeric parts count as zero. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(part => Number.parseInt(part, 10) || 0)
  const right = b.split('.').map(part => Number.parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) {return diff}
  }
  return 0
}

/** A ruby gem locked in the application's Gemfile.lock. The lockfile answers this, so no machine probe runs. */
export function isProjectInstall(entry: AdapterEntry, projectGems: ReadonlyMap<string, string>): boolean {
  return entry.package.kind === 'ruby-gem' && projectGems.has(entry.package.name)
}

/**
 * `globalProbe` is omitted when the lockfile already answers, and must be supplied otherwise. A tool whose probe
 * was not run is `unknown`, never `missing`.
 */
export function resolveAdapterState(input: {
  entry: AdapterEntry
  projectGems: ReadonlyMap<string, string>
  globalProbe?: GlobalProbe
  detectedRuby?: string
}): AdapterState {
  const { entry, projectGems, globalProbe, detectedRuby } = input
  if (isProjectInstall(entry, projectGems)) {
    return { kind: 'installed', where: 'project', version: projectGems.get(entry.package.name) }
  }
  if (!globalProbe) {return { kind: 'unknown', reason: 'probe-failed' }}
  if (globalProbe.found === true) {
    if (entry.minimumRuby && detectedRuby && compareVersions(detectedRuby, entry.minimumRuby) < 0) {
      return { kind: 'ruby-too-old', detected: detectedRuby, required: entry.minimumRuby }
    }
    return { kind: 'installed', where: 'global', version: globalProbe.version }
  }
  if (globalProbe.found === false) {return { kind: 'missing' }}
  if (globalProbe.reason === 'toolchain-missing') {
    return { kind: 'toolchain-missing', tool: entry.package.kind === 'npm' ? 'npm' : 'gem' }
  }
  return { kind: 'unknown', reason: globalProbe.reason === 'untrusted' ? 'untrusted' : 'probe-failed' }
}

/** Asks the user about a missing tool only when the user enabled it, and not after they dismissed it. */
export function shouldPromptForMissing(input: {
  enabled: boolean
  promptWhenMissing: boolean
  dismissed: boolean
  state: AdapterState
}): boolean {
  return input.enabled && input.promptWhenMissing && !input.dismissed && input.state.kind === 'missing'
}

export interface LaunchSpec {
  command: string
  args: readonly string[]
  cwd: string
}

/**
 * How to start an installed tool. A gem installed in the application's Gemfile runs through Bundler, so it uses
 * the application's locked version. Anything else runs from its global executable. Returns undefined when the tool
 * is not installed or its executable is not known.
 */
export function launchSpecFor(entry: AdapterEntry, state: AdapterState, root: string): LaunchSpec | undefined {
  if (state.kind !== 'installed') {return undefined}
  const executable = entry.package.executable
  if (!executable) {return undefined}
  if (state.where === 'project') {
    return { command: 'bundle', args: ['exec', executable], cwd: root }
  }
  return { command: executable, args: [], cwd: root }
}

/** One plain sentence for the state, for the status list and the details document. */
export function describeState(state: AdapterState): string {
  switch (state.kind) {
    case 'installed':
      return state.where === 'project'
        ? `Installed in this application${state.version ? ` (${state.version})` : ''}.`
        : `Installed globally${state.version ? ` (${state.version})` : ''}.`
    case 'missing':
      return 'Not installed.'
    case 'toolchain-missing':
      return `The ${state.tool} command was not found, so the install could not be checked.`
    case 'ruby-too-old':
      return `Installed, but the Ruby on this machine (${state.detected}) is older than the required ${state.required}.`
    case 'unknown':
      return state.reason === 'untrusted'
        ? 'Not checked. Trust this workspace to check global installs.'
        : 'Not checked: the check did not complete.'
  }
}
