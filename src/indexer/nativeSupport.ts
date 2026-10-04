/**
 * nativeSupport - gates whether it's safe to load better-sqlite3 at all.
 *
 * better-sqlite3's N-API build hardcodes NAPI_VERSION=10 (every published version,
 * 13.0.0+, no lower-NAPI release exists). Node's own N-API version matrix backported
 * version 10 only to >= 22.14 / 23.6 — Node 20.x (and older 22.x patches) top out at
 * N-API 9. Loading an addon that requests an unsupported N-API version doesn't throw a
 * catchable JS error: it calls the native `napi_fatal_error`, which aborts the entire
 * process immediately. try/catch cannot protect against this — the only safe fix is to
 * never call `require('better-sqlite3')` (see database.ts's lazy require) unless this
 * check has already confirmed the runtime supports it.
 */

import * as fs from 'fs'
import { execSync } from 'child_process'

const REQUIRED_NAPI_VERSION = 10
const REQUIRED_LINUX_GLIBC = [2, 33]

const LIBC_PATHS = [
  '/lib/x86_64-linux-gnu/libc.so.6',
  '/usr/lib/x86_64-linux-gnu/libc.so.6',
  '/lib64/libc.so.6',
  '/lib/aarch64-linux-gnu/libc.so.6',
  '/usr/lib/aarch64-linux-gnu/libc.so.6',
]

function parseGlibcFromLibc(libcPath: string): string | undefined {
  try {
    const buf = fs.readFileSync(libcPath)
    // GLIBC version symbols are strings like "GLIBC_2.31", "GLIBC_2.33"
    // Scan the binary for GLIBC_2.xx patterns
    const str = buf.toString('latin1')
    const matches = str.match(/GLIBC_(\d+\.\d+)/g)
    if (!matches) return undefined
    // Find the highest version
    const versions = matches
      .map((m: string) => m.slice(7))
      .map((v: string) => v.split('.').map(Number) as [number, number])
      .sort((a: [number, number], b: [number, number]) => b[0] - a[0] || b[1] - a[1])
    const [major, minor] = versions[0]
    return `${major}.${minor}`
  } catch {
    return undefined
  }
}

function parseGlibcFromLdd(): string | undefined {
  try {
    const output = execSync('ldd --version', { encoding: 'utf8', timeout: 1000 })
    // Output like: "ldd (Ubuntu GLIBC 2.31-0ubuntu9.18) 2.31"
    const match = output.match(/GLIBC\s+(\d+\.\d+)/i)
    if (match) return match[1]
    // Fallback: parse last version-like string
    const versions = output.match(/\b(\d+\.\d+)\b/g)
    if (versions) return versions[versions.length - 1]
  } catch {
    // ldd not available or failed
  }
  return undefined
}

export function getLinuxGlibcVersion(): string | undefined {
  if (process.platform !== 'linux') {return undefined}

  // 1. Try process.report (works in standard Node, not always in Electron)
  try {
    const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string } } | undefined
    if (report?.header?.glibcVersionRuntime) {
      return report.header.glibcVersionRuntime
    }
  } catch {
    // Some sandboxed/embedded hosts (e.g. remote extension hosts) can throw here
  }

  // 2. Fallback: parse ldd --version output (returns actual runtime GLIBC version)
  const lddVersion = parseGlibcFromLdd()
  if (lddVersion) return lddVersion

  // 3. Fallback: scan libc binary for GLIBC version symbols (may be lower than runtime)
  for (const path of LIBC_PATHS) {
    const version = parseGlibcFromLibc(path)
    if (version) return version
  }

  return undefined
}

export interface PersistentIndexSupport {
  supported: boolean
  /** Human-readable explanation when unsupported (shown to the user). */
  reason?: string
}

let cachedSupport: PersistentIndexSupport | undefined

export function resetPersistentIndexSupportCache(): void {
  cachedSupport = undefined
}

/**
 * Same gate as isPersistentIndexSupported, but says *why* it failed so the UI can tell the
 * user instead of silently disabling the AST features.
 */
export function getPersistentIndexSupport(): PersistentIndexSupport {
  if (cachedSupport) {return cachedSupport}

  const napiVersion = Number(process.versions.napi)
  if (!Number.isFinite(napiVersion) || napiVersion < REQUIRED_NAPI_VERSION) {
    cachedSupport = {
      supported: false,
      reason: `this VS Code's runtime provides N-API ${Number.isFinite(napiVersion) ? napiVersion : 'unknown'} (Node ${process.versions.node}); the SQLite module needs N-API >= ${REQUIRED_NAPI_VERSION} (Node >= 22.14). Updating VS Code to a build bundling Node 22.14+ enables it.`,
    }
    return cachedSupport
  }

  // better-sqlite3 Linux prebuilt binary requires GLIBC >= 2.33. If the version can't be
  // determined, fail closed — loading the addon on an unverified runtime risks the
  // unrecoverable napi_fatal_error abort described above.
  if (process.platform === 'linux') {
    const glibcStr = getLinuxGlibcVersion()
    const need = REQUIRED_LINUX_GLIBC.join('.')
    if (!glibcStr) {
      cachedSupport = { supported: false, reason: `could not determine the system GLIBC version (needs >= ${need}).` }
      return cachedSupport
    }
    const [major, minor] = glibcStr.split('.').map(Number)
    if (major < REQUIRED_LINUX_GLIBC[0] || (major === REQUIRED_LINUX_GLIBC[0] && minor < REQUIRED_LINUX_GLIBC[1])) {
      cachedSupport = { supported: false, reason: `system GLIBC ${glibcStr} is older than the required ${need}.` }
      return cachedSupport
    }
  }

  cachedSupport = { supported: true }
  return cachedSupport
}

export function isPersistentIndexSupported(): boolean {
  return getPersistentIndexSupport().supported
}
