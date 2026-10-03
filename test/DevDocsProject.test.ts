import { describe, it, expect, vi } from 'vitest'
import * as path from 'path'
import { DevDocsProject } from '../src/docs/DevDocsProject'

describe('DevDocsProject', () => {
  it('caches inside its own root and uses that root\'s slugs', async () => {
    const ensure = vi.fn(async () => true)
    const createFetcher = vi.fn(() => ({ ensureDocset: ensure }))
    const a = new DevDocsProject('/ws/a', { createFetcher, slugsFor: () => ['ruby~3.2', 'rails~7.1'] })
    const b = new DevDocsProject('/ws/b', { createFetcher, slugsFor: () => ['ruby~3.3'] })

    expect(a.cacheDir).toBe(path.join('/ws/a', '.railsforge', 'devdocs'))
    expect(b.cacheDir).toBe(path.join('/ws/b', '.railsforge', 'devdocs'))
    expect(createFetcher).toHaveBeenNthCalledWith(1, a.cacheDir)
    expect(createFetcher).toHaveBeenNthCalledWith(2, b.cacheDir)

    expect(await a.refresh(false)).toEqual([true, true])
    expect(a.slugs).toEqual(['ruby~3.2', 'rails~7.1'])
    expect(b.slugs).toEqual([])
    expect(ensure).toHaveBeenCalledWith('ruby~3.2', false)
  })

  it('swaps in a fresh index after refresh and reports partial failures per slug', async () => {
    const project = new DevDocsProject('/ws/a', {
      createFetcher: () => ({ ensureDocset: async (slug: string) => slug === 'ruby~3.2' }),
      slugsFor: () => ['ruby~3.2', 'rails~7.1'],
    })
    const before = project.index
    expect(await project.refresh(true)).toEqual([true, false])
    expect(project.index).not.toBe(before)
  })
})
