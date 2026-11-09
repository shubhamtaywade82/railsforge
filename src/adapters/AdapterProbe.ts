/**
 * AdapterProbe - asks the machine whether an optional tool is installed globally. Every probe starts a process, so
 * every probe goes through ProjectProcess and is refused in an untrusted workspace. A refused or failed probe says
 * so. It never reports "not installed" when the question was not actually answered.
 *
 * vscode-free.
 */

import { execFileAsync } from '../util/ProjectProcess'
import { UntrustedWorkspaceError } from '../workspace/Trust'
import type { GlobalProbe } from './AdapterStatus'

const PROBE_TIMEOUT_MS = 20_000

/** Asks RubyGems, through `gem list -i`, whether a gem is installed for the active Ruby. */
export async function probeGlobalGem(name: string, cwd: string): Promise<GlobalProbe> {
  try {
    const { stdout } = await execFileAsync('gem', ['list', '-i', name], { cwd, timeout: PROBE_TIMEOUT_MS })
    return { found: stdout.trim() === 'true' }
  } catch (err) {
    // `gem list -i` can exit non-zero while printing "false" when the gem is absent.
    const printed = stdoutOf(err)
    if (printed !== undefined && printed.trim() === 'false') {return { found: false }}
    return failure(err)
  }
}

/** Asks npm whether a package is installed globally. npm exits non-zero when it is absent, but still prints JSON. */
export async function probeGlobalNpm(name: string, cwd: string): Promise<GlobalProbe> {
  try {
    const { stdout } = await execFileAsync('npm', ['ls', '-g', name, '--depth=0', '--json'], { cwd, timeout: PROBE_TIMEOUT_MS })
    return fromNpmListing(stdout, name)
  } catch (err) {
    const printed = stdoutOf(err)
    if (printed !== undefined) {return fromNpmListing(printed, name)}
    return failure(err)
  }
}

/** The Ruby version the workspace's `ruby` reports, or undefined when it cannot be read. */
export async function probeRubyVersion(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('ruby', ['-e', 'print RUBY_VERSION'], { cwd, timeout: PROBE_TIMEOUT_MS })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

export function fromNpmListing(printed: string, name: string): GlobalProbe {
  try {
    const parsed = JSON.parse(printed) as { dependencies?: Record<string, { version?: string } | undefined> }
    const entry = parsed.dependencies?.[name]
    return entry ? { found: true, version: entry.version } : { found: false }
  } catch {
    return { found: null, reason: 'probe-failed' }
  }
}

function stdoutOf(err: unknown): string | undefined {
  const printed = (err as { stdout?: unknown }).stdout
  return typeof printed === 'string' ? printed : undefined
}

function failure(err: unknown): GlobalProbe {
  if (err instanceof UntrustedWorkspaceError) {return { found: null, reason: 'untrusted' }}
  if ((err as { code?: unknown }).code === 'ENOENT') {return { found: null, reason: 'toolchain-missing' }}
  return { found: null, reason: 'probe-failed' }
}
