import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { execFileAsync, spawnProject } from '../src/util/ProjectProcess'
import { UntrustedWorkspaceError, setTrustProvider } from '../src/workspace/Trust'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-trust-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
afterEach(() => setTrustProvider(() => true))

/** A command that proves it ran by creating a file. */
const touch = (name: string): [string, string[]] => [process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(path.join(tmp, name))}, 'ran')`]]

describe('execFileAsync', () => {
  it('runs when trusted', async () => {
    const { stdout } = await execFileAsync(process.execPath, ['-e', 'console.log("hi")'])
    expect(stdout.trim()).toBe('hi')
  })

  it('does not start the process when untrusted', async () => {
    setTrustProvider(() => false)
    const [cmd, args] = touch('exec-ran')
    await expect(execFileAsync(cmd, args)).rejects.toBeInstanceOf(UntrustedWorkspaceError)
    await new Promise(r => setTimeout(r, 150))
    expect(fs.existsSync(path.join(tmp, 'exec-ran'))).toBe(false)
  })

  it('is refused even when the caller wraps it in try/catch-and-continue (it throws, it does not silently succeed)', async () => {
    setTrustProvider(() => false)
    let outcome = 'ran'
    try { await execFileAsync(process.execPath, ['-e', '']) } catch { outcome = 'refused' }
    expect(outcome).toBe('refused')
  })
})

describe('spawnProject', () => {
  it('spawns when trusted and keeps spawn()\'s typed stdio', async () => {
    const child = spawnProject(process.execPath, ['-e', 'process.stdout.write("out")'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', d => { out += String(d) })
    await new Promise(resolve => child.on('close', resolve))
    expect(out).toBe('out')
  })

  it('throws before spawning when untrusted', async () => {
    setTrustProvider(() => false)
    const [cmd, args] = touch('spawn-ran')
    expect(() => spawnProject(cmd, args, { stdio: 'ignore' })).toThrow(UntrustedWorkspaceError)
    await new Promise(r => setTimeout(r, 150))
    expect(fs.existsSync(path.join(tmp, 'spawn-ran'))).toBe(false)
  })
})
