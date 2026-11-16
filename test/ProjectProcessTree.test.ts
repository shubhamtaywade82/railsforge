// The options a launch is started with, and the calls that stop it, with child_process replaced by a stand-in for this
// file only. Each assertion pins one option or one call, so a change to either is caught on every host, including the
// Windows branch that stops the process tree, which a Linux host cannot run for real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFile, spawnSync } from 'child_process'
import { runProjectTool, runToolLaunch } from '../src/util/ProjectProcess'
import { setTrustProvider } from '../src/workspace/Trust'
import { ToolLaunch } from '../src/util/WindowsLaunch'

vi.mock('child_process', () => ({ execFile: vi.fn(), spawn: vi.fn(), spawnSync: vi.fn() }))

type Callback = (err: Error | null, stdout?: string, stderr?: string) => void

const CMD: ToolLaunch = { file: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/c', '""C:\\r\\bundle.CMD" "exec" "rake" "-T""'], viaCmd: true }

let callback: Callback
let child: { pid: number | undefined; kill: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.mocked(execFile).mockReset()
  vi.mocked(spawnSync).mockReset()
  setTrustProvider(() => true)
  // A process that reports its end through the callback when it is killed, as a real one does.
  child = { pid: 4321, kill: vi.fn(() => callback(new Error('killed'))) }
  vi.mocked(execFile).mockImplementation(((_file: string, _args: string[], _options: unknown, cb: Callback) => {
    callback = cb
    return child
  }) as unknown as typeof execFile)
})

afterEach(() => {
  setTrustProvider(() => false)
})

describe('how a batch shim is started', () => {
  it('starts it with its arguments verbatim and no window, and resolves with the output', async () => {
    const run = runToolLaunch(CMD, { cwd: '/work', maxBuffer: 99 }, 'win32')
    expect(execFile).toHaveBeenCalledWith(CMD.file, CMD.args, { cwd: '/work', maxBuffer: 99, windowsHide: true, windowsVerbatimArguments: true }, expect.any(Function))
    callback(null, 'out', 'err')
    await expect(run).resolves.toEqual({ stdout: 'out', stderr: 'err' })
  })

  it('rejects with the error the process reports', async () => {
    const run = runToolLaunch(CMD, {}, 'win32')
    callback(new Error('exit 1'))
    await expect(run).rejects.toThrow('exit 1')
  })

  it('starts nothing when the call is already cancelled, and rejects as aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(runToolLaunch(CMD, { signal: controller.signal }, 'win32')).rejects.toMatchObject({ name: 'AbortError', message: 'The operation was aborted' })
    expect(execFile).not.toHaveBeenCalled()
  })
})

describe('stopping a batch shim', () => {
  it('on Windows, stops the whole tree with taskkill before killing cmd.exe, and rejects as aborted', async () => {
    const controller = new AbortController()
    const run = runToolLaunch(CMD, { signal: controller.signal }, 'win32')
    controller.abort()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawnSync).toHaveBeenCalledWith('taskkill', ['/pid', '4321', '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(vi.mocked(spawnSync).mock.invocationCallOrder[0]).toBeLessThan(child.kill.mock.invocationCallOrder[0])
  })

  it('off Windows, kills the process without running taskkill', async () => {
    const controller = new AbortController()
    const run = runToolLaunch(CMD, { signal: controller.signal }, 'linux')
    controller.abort()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawnSync).not.toHaveBeenCalled()
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('kills the process without a tree stop when it has no process id', async () => {
    child.pid = undefined
    const controller = new AbortController()
    const run = runToolLaunch(CMD, { signal: controller.signal }, 'win32')
    controller.abort()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawnSync).not.toHaveBeenCalled()
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('stops nothing when the call is cancelled after the process has finished', async () => {
    const controller = new AbortController()
    const run = runToolLaunch(CMD, { signal: controller.signal }, 'win32')
    callback(null, 'done', '')
    await expect(run).resolves.toEqual({ stdout: 'done', stderr: '' })
    controller.abort()
    expect(child.kill).not.toHaveBeenCalled()
    expect(spawnSync).not.toHaveBeenCalled()
  })

  it('stops a process that outlasts its time limit, and rejects with ETIMEDOUT naming the program and the limit', async () => {
    const run = runToolLaunch(CMD, { timeout: 25 }, 'win32')
    await expect(run).rejects.toMatchObject({ code: 'ETIMEDOUT', message: 'C:\\Windows\\System32\\cmd.exe timed out after 25 ms' })
    expect(spawnSync).toHaveBeenCalledWith('taskkill', ['/pid', '4321', '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('does not stop a process that finishes within its time limit', async () => {
    const run = runToolLaunch(CMD, { timeout: 5_000 }, 'win32')
    callback(null, 'quick', '')
    await expect(run).resolves.toEqual({ stdout: 'quick', stderr: '' })
    expect(child.kill).not.toHaveBeenCalled()
  })
})

describe('a project tool outside Windows', () => {
  it('is started as given, with its options passed through unchanged', async () => {
    const controller = new AbortController()
    vi.mocked(execFile).mockImplementationOnce(((_file: string, _args: string[], _options: unknown, cb: Callback) => {
      cb(null, 'out', '')
      return child
    }) as unknown as typeof execFile)
    await runProjectTool('bundle', ['exec', 'rake', '-T'], { cwd: '/app', maxBuffer: 5, timeout: 7, signal: controller.signal })
    expect(execFile).toHaveBeenCalledWith('bundle', ['exec', 'rake', '-T'], { cwd: '/app', maxBuffer: 5, timeout: 7, signal: controller.signal }, expect.any(Function))
  })

  it('starts nothing in a workspace that is not trusted', async () => {
    setTrustProvider(() => false)
    await expect(runProjectTool('bundle', ['-T'], {})).rejects.toThrow()
    expect(execFile).not.toHaveBeenCalled()
  })
})
