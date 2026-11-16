// Cancellation of a native tool that runs a process, in-process. A stand-in `bundle` runs until it is stopped, and a
// stand-in `rake` records whether it started. The listing must stop the running process, and must not start the next
// candidate. A handler that fails after the call was cancelled is reported as CANCELLED, not as its own failure.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawnSync } from 'child_process'
import { RakeTaskIndexer } from '../src/rake/RakeTaskIndexer'
import { setTrustProvider } from '../src/workspace/Trust'
import { invokeTool, InvocableTool, ToolCallError } from '../src/mcp/policy/ToolInvocation'

describe('a cancelled Rake listing', () => {
  let work: string
  let fake: string
  let originalPath: string | undefined

  beforeEach(() => {
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-native-cancel-')))
    // The stand-in commands live outside the project: a `bin/` inside it would be the project's own binstub, which the
    // indexer tries first.
    fake = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-native-bin-')))
    // The project has a Gemfile, so the Bundler candidate is tried first, and bare `rake` second.
    fs.writeFileSync(path.join(work, 'Gemfile'), "source 'https://rubygems.org'\n")
    fs.writeFileSync(path.join(fake, 'bundle'), `#!/bin/sh\necho started > "${work}/bundle-started"\nwhile true; do sleep 0.1; done\n`)
    fs.writeFileSync(path.join(fake, 'rake'), `#!/bin/sh\necho started >> "${work}/rake-started"\necho "rake db:migrate  # Migrate"\n`)
    fs.chmodSync(path.join(fake, 'bundle'), 0o755)
    fs.chmodSync(path.join(fake, 'rake'), 0o755)
    originalPath = process.env.PATH
    process.env.PATH = `${fake}${path.delimiter}${originalPath ?? ''}`
    setTrustProvider(() => true)
  })

  afterEach(() => {
    process.env.PATH = originalPath
    setTrustProvider(() => false)
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    fs.rmSync(fake, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  it('stops the running process, reports CANCELLED, and does not start the next candidate', async () => {
    const controller = new AbortController()
    const listing = new RakeTaskIndexer().listTasks(work, controller.signal)
    await expect.poll(() => fs.existsSync(path.join(work, 'bundle-started')), { timeout: 10_000 }).toBe(true)

    const abortedAt = Date.now()
    controller.abort()
    await expect(listing).rejects.toMatchObject({ code: 'CANCELLED' })
    await expect(listing).rejects.toBeInstanceOf(ToolCallError)
    // Prompt, not at the 15 s timeout: the cancellation must stop the process, not wait for it to finish.
    expect(Date.now() - abortedAt).toBeLessThan(5_000)

    // The stand-in bundle is gone, and the next candidate never started.
    await expect.poll(() => spawnSync('pgrep', ['-f', fake]).status !== 0, { timeout: 3_000 }).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(fs.existsSync(path.join(work, 'rake-started'))).toBe(false)
  }, 30_000)
})

describe('invocation: a failure after cancellation is the cancellation', () => {
  it('reports CANCELLED, whatever the handler threw once the call was cancelled', async () => {
    const controller = new AbortController()
    const tool: InvocableTool<unknown> = {
      name: 'fails_after_cancel',
      risk: 'R0',
      handler: async (_ctx, _input, signal) => {
        controller.abort()
        throw new Error(`process exited: ${signal?.aborted ? 'after' : 'before'} the cancel`)
      },
    }
    const result = await invokeTool(tool, {}, {}, { source: 'standalone', isTrusted: () => true, signal: controller.signal })
    expect(result).toMatchObject({ ok: false, code: 'CANCELLED' })
  })

  it('still reports an ordinary failure as TOOL_FAILED when nothing was cancelled', async () => {
    const tool: InvocableTool<unknown> = {
      name: 'fails',
      risk: 'R0',
      handler: async () => { throw new Error('boom') },
    }
    const result = await invokeTool(tool, {}, {}, { source: 'standalone', isTrusted: () => true })
    expect(result).toMatchObject({ ok: false, code: 'TOOL_FAILED' })
  })
})
