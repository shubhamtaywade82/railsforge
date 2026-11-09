/**
 * AdapterService - reports the state of the optional tools for one workspace root. It reads Gemfile.lock (no code
 * runs), then runs the global probes, which are trust-gated. In an untrusted workspace the project check still
 * works and the global checks report `unknown`.
 *
 * vscode-free.
 */

import * as fs from 'fs'
import * as path from 'path'
import { parseGemfileLock } from '../gems/GemfileLockParser'
import { ADAPTERS, ADAPTER_IDS, AdapterEntry, AdapterId } from './AdapterCatalog'
import { probeGlobalGem, probeGlobalNpm, probeRubyVersion } from './AdapterProbe'
import { AdapterState, isProjectInstall, resolveAdapterState } from './AdapterStatus'

export interface AdapterReport {
  entry: AdapterEntry
  state: AdapterState
}

export async function reportAdapters(root: string, ids: readonly AdapterId[] = ADAPTER_IDS): Promise<AdapterReport[]> {
  const lockfile = readFileIfPresent(path.join(root, 'Gemfile.lock'))
  const projectGems = lockfile === undefined ? new Map<string, string>() : parseGemfileLock(lockfile)
  const selected = ADAPTERS.filter(entry => ids.includes(entry.id))
  // The Ruby version is asked only when a global probe needs it: a lockfile answer runs nothing.
  const needsMachine = selected.some(entry => !isProjectInstall(entry, projectGems))
  const detectedRuby = needsMachine ? await probeRubyVersion(root) : undefined
  return Promise.all(selected.map(async entry => {
    if (isProjectInstall(entry, projectGems)) {
      return { entry, state: resolveAdapterState({ entry, projectGems }) }
    }
    const globalProbe = entry.package.kind === 'npm'
      ? await probeGlobalNpm(entry.package.name, root)
      : await probeGlobalGem(entry.package.name, root)
    return { entry, state: resolveAdapterState({ entry, projectGems, globalProbe, detectedRuby }) }
  }))
}

function readFileIfPresent(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}
