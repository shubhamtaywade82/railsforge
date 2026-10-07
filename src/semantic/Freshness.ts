/**
 * Freshness - answers "is this graph still a faithful picture of the files on disk?" by re-statting
 * the inputs it was built from and re-listing the source tree (stat only, no reads), so callers can
 * keep a cached graph until something actually changed.
 */

import * as fs from 'fs'
import * as path from 'path'
import { GraphProvenance } from './types'
import { listSourcePaths, WELL_KNOWN_INPUTS } from './GraphBuilder'

export interface FreshnessReport {
  fresh: boolean
  changed: string[]
  added: string[]
  removed: string[]
  /** Runtime facts are older than the schema or a model file. */
  runtimeStale: boolean
  /** The scan was cut short by the file cap; "fresh" only describes the scanned part. */
  partial: boolean
}

function statOf(root: string, rel: string): fs.Stats | undefined {
  try { return fs.statSync(path.join(root, rel)) } catch { return undefined }
}

export function checkFreshness(provenance: GraphProvenance, excluded: ReadonlySet<string>, maxFiles = 6000): FreshnessReport {
  const { root } = provenance
  const changed: string[] = []
  const removed: string[] = []
  const known = new Set<string>()
  for (const input of provenance.inputs) {
    known.add(input.path)
    const stat = statOf(root, input.path)
    if (!stat) {removed.push(input.path)}
    else if (stat.mtimeMs !== input.mtimeMs || stat.size !== input.size) {changed.push(input.path)}
  }

  const added: string[] = []
  for (const rel of provenance.absent) {
    if (statOf(root, rel)) {added.push(rel)}
  }
  for (const rel of listSourcePaths(root, excluded, maxFiles)) {
    if (!known.has(rel) && !added.includes(rel)) {added.push(rel)}
  }

  const touchedRuntime = changed.includes('.railsforge/runtime.json') || added.includes('.railsforge/runtime.json')
  const fresh = changed.length === 0 && removed.length === 0 && added.length === 0
  return {
    fresh,
    changed: changed.sort(),
    added: added.sort(),
    removed: removed.sort(),
    runtimeStale: provenance.runtimeStale && !touchedRuntime,
    partial: provenance.truncated,
  }
}

/** One-line human summary of a freshness report. */
export function describeFreshness(report: FreshnessReport): string {
  if (report.fresh) {return report.partial ? 'up to date (file cap reached: partial view)' : 'up to date'}
  const parts: string[] = []
  if (report.changed.length) {parts.push(`${report.changed.length} changed`)}
  if (report.added.length) {parts.push(`${report.added.length} added`)}
  if (report.removed.length) {parts.push(`${report.removed.length} removed`)}
  return `stale (${parts.join(', ')})`
}

export { WELL_KNOWN_INPUTS }
