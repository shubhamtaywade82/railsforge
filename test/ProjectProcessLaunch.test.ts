// The paths of a launch that runs through cmd.exe on Windows: success, failure, cancellation and timeout. The launched
// program is node itself, so these run on every host. The Windows branch (which stops the whole tree with taskkill) is
// taken by passing 'win32'; on a Linux host taskkill does not exist, and the call is simply ignored there.
import { describe, it, expect } from 'vitest'
import { runToolLaunch } from '../src/util/ProjectProcess'
import { ToolLaunch } from '../src/util/WindowsLaunch'

const node = (script: string): ToolLaunch => ({ file: process.execPath, args: ['-e', script], viaCmd: true })
// No spaces: a batch-shim launch passes its arguments verbatim, so on Windows a space would split the script.
const LONG_RUN = 'setTimeout(()=>{},20000)'

describe('runToolLaunch', () => {
  it('resolves with the output of a run that succeeds', async () => {
    await expect(runToolLaunch(node('console.log(1)'), {})).resolves.toEqual({ stdout: '1\n', stderr: '' })
  })

  it('rejects a run that exits with an error', async () => {
    await expect(runToolLaunch(node('process.exit(3)'), {})).rejects.toBeInstanceOf(Error)
  })

  it('rejects at once, and starts nothing, when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const started = Date.now()
    await expect(runToolLaunch(node(LONG_RUN), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('stops a running process when the call is cancelled, and rejects as aborted', async () => {
    const controller = new AbortController()
    const run = runToolLaunch(node(LONG_RUN), { signal: controller.signal })
    setTimeout(() => controller.abort(), 200)
    const started = Date.now()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('takes the Windows path when cancelled, which stops the process tree, and still rejects as aborted', async () => {
    const controller = new AbortController()
    const run = runToolLaunch(node(LONG_RUN), { signal: controller.signal }, 'win32')
    setTimeout(() => controller.abort(), 200)
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects a run that outlasts its timeout, with ETIMEDOUT, and stops it', async () => {
    const started = Date.now()
    await expect(runToolLaunch(node(LONG_RUN), { timeout: 300 })).rejects.toMatchObject({ code: 'ETIMEDOUT' })
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('takes the Windows path on a timeout too, and rejects with ETIMEDOUT', async () => {
    await expect(runToolLaunch(node(LONG_RUN), { timeout: 300 }, 'win32')).rejects.toMatchObject({ code: 'ETIMEDOUT' })
  })

  it('rejects a program that cannot be started', async () => {
    await expect(runToolLaunch({ file: '/nonexistent/railsforge-tool', args: [], viaCmd: true }, {})).rejects.toBeInstanceOf(Error)
  })
})
