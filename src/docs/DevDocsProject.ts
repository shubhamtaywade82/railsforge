/**
 * DevDocsProject - the offline DevDocs cache + lookup index for ONE workspace root.
 *
 * Cache is workspace-local (<root>/.railsforge/devdocs, not globalStorageUri) so the
 * standalone MCP server can find it too. Slugs come from that root's own Ruby/Rails
 * versions, so two projects on different versions each get matching docsets.
 */

import * as path from 'path'
import { DevDocsOfflineIndex } from './DevDocsOfflineIndex'
import { Logger } from '../util/Logger'

export interface DocsetFetcher {
  ensureDocset(slug: string, forceRefresh: boolean): Promise<boolean>
}

export interface DevDocsProjectDeps {
  /** Builds a fetcher writing into `cacheDir`. */
  createFetcher: (cacheDir: string) => DocsetFetcher
  /** Slugs to cache for this root (derived from its own environment + settings). */
  slugsFor: (root: string) => string[]
}

export class DevDocsProject {
  readonly cacheDir: string
  private readonly fetcher: DocsetFetcher
  private _index: DevDocsOfflineIndex
  private _slugs: string[] = []

  constructor(readonly root: string, private readonly deps: DevDocsProjectDeps) {
    this.cacheDir = path.join(root, '.railsforge', 'devdocs')
    this.fetcher = deps.createFetcher(this.cacheDir)
    // Empty until refresh() finishes; hovers read through `index` so they pick it up live.
    this._index = new DevDocsOfflineIndex(this.cacheDir, [])
  }

  get index(): DevDocsOfflineIndex {
    return this._index
  }

  get slugs(): string[] {
    return this._slugs
  }

  /** Downloads (or reuses cached) docsets for this root and swaps in a fresh index. */
  async refresh(forceRefresh: boolean): Promise<boolean[]> {
    const slugs = this.deps.slugsFor(this.root)
    this._slugs = slugs
    const results = await Promise.all(slugs.map(slug => this.fetcher.ensureDocset(slug, forceRefresh)))
    this._index = new DevDocsOfflineIndex(this.cacheDir, slugs)
    if (results.some(Boolean)) {
      Logger.info(`RailsForge: offline DevDocs cache ready for ${slugs.filter((_, i) => results[i]).join(', ')} (${this.root}).`)
    }
    if (results.some(ok => !ok)) {
      Logger.warn(`RailsForge: could not download offline DevDocs data for ${slugs.filter((_, i) => !results[i]).join(', ')} (offline, or docset unavailable at that slug).`)
    }
    return results
  }
}
