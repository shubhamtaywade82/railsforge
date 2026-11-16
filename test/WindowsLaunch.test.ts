// How a project tool is resolved to the file that runs. These run on every platform: the Windows cases pass a Windows
// environment and a fake file system, so they are checked here as well as on the Windows CI job.
import { describe, it, expect } from 'vitest'
import { LaunchEnv, resolveToolLaunch } from '../src/util/WindowsLaunch'

const COMSPEC = 'C:\\Windows\\System32\\cmd.exe'

/** Windows file names are case-insensitive, so the fake file system is too. PATHEXT is upper-case, as on Windows. */
function windowsEnv(files: string[], overrides: Partial<LaunchEnv> = {}): LaunchEnv {
  const present = new Set(files.map(file => file.toLowerCase()))
  return {
    platform: 'win32',
    pathValue: 'C:\\Ruby33\\bin;C:\\Tools',
    pathext: '.COM;.EXE;.BAT;.CMD',
    comSpec: COMSPEC,
    exists: file => present.has(file.toLowerCase()),
    ...overrides,
  }
}

describe('resolveToolLaunch on Windows', () => {
  it('runs a batch shim through cmd.exe, verbatim, with its path and each argument quoted', () => {
    const launch = resolveToolLaunch('bundle', ['exec', 'rake', '-T'], windowsEnv(['C:\\Ruby33\\bin\\bundle.cmd']))
    expect(launch).toEqual({
      file: COMSPEC,
      // The quoted command is wrapped in one more pair: cmd.exe removes that pair after /c, and keeps the rest.
      args: ['/d', '/s', '/c', '""C:\\Ruby33\\bin\\bundle.CMD" "exec" "rake" "-T""'],
      viaCmd: true,
    })
  })

  it('runs an executable directly, with its arguments unchanged', () => {
    const launch = resolveToolLaunch('ruby', ['-v'], windowsEnv(['C:\\Ruby33\\bin\\ruby.exe']))
    expect(launch).toEqual({ file: 'C:\\Ruby33\\bin\\ruby.EXE', args: ['-v'], viaCmd: false })
  })

  it('prefers an executable over a batch file in the same directory, in PATHEXT order', () => {
    const launch = resolveToolLaunch('rake', ['-T'], windowsEnv(['C:\\Ruby33\\bin\\rake.bat', 'C:\\Ruby33\\bin\\rake.exe']))
    expect(launch).toEqual({ file: 'C:\\Ruby33\\bin\\rake.EXE', args: ['-T'], viaCmd: false })
  })

  it('quotes a path with spaces as one argument', () => {
    const launch = resolveToolLaunch('rake', ['-T'], windowsEnv(['C:\\Program Files\\Ruby\\bin\\rake.bat'], { pathValue: 'C:\\Program Files\\Ruby\\bin' }))
    expect(launch.args[3]).toBe('""C:\\Program Files\\Ruby\\bin\\rake.BAT" "-T""')
  })

  it('uses an explicit path to a shim as given', () => {
    const launch = resolveToolLaunch('C:\\tools\\rake.cmd', ['-T'], windowsEnv(['C:\\tools\\rake.cmd']))
    expect(launch).toMatchObject({ file: COMSPEC, viaCmd: true })
    expect(launch.args[3]).toBe('""C:\\tools\\rake.cmd" "-T""')
  })

  it('does not match a bare file without an extension, which Windows cannot run', () => {
    const launch = resolveToolLaunch('bundle', ['exec'], windowsEnv(['C:\\Ruby33\\bin\\bundle']))
    expect(launch).toEqual({ file: 'bundle', args: ['exec'], viaCmd: false })
  })

  it('leaves a command that is not on PATH unchanged, so the OS reports it as before', () => {
    const launch = resolveToolLaunch('bundle', ['exec'], windowsEnv([]))
    expect(launch).toEqual({ file: 'bundle', args: ['exec'], viaCmd: false })
  })

  it('refuses an argument that cmd.exe cannot quote, rather than running it badly', () => {
    expect(() => resolveToolLaunch('rake', ['a"b'], windowsEnv(['C:\\Ruby33\\bin\\rake.cmd']))).toThrow(/cannot quote it safely/)
    expect(() => resolveToolLaunch('rake', ['%PATH%'], windowsEnv(['C:\\Ruby33\\bin\\rake.cmd']))).toThrow(/cannot quote it safely/)
    expect(() => resolveToolLaunch('rake', ['a\nb'], windowsEnv(['C:\\Ruby33\\bin\\rake.cmd']))).toThrow(/cannot quote it safely/)
  })

  it('refuses a batch file whose own path cannot be quoted', () => {
    const dir = 'C:\\100%\\bin'
    expect(() => resolveToolLaunch('rake', ['-T'], windowsEnv([`${dir}\\rake.cmd`], { pathValue: dir }))).toThrow(/cannot quote it safely/)
  })
})

describe('resolveToolLaunch elsewhere', () => {
  it('never rewrites a launch on a POSIX platform, even when a batch file of that name exists', () => {
    const launch = resolveToolLaunch('bundle', ['exec', 'rake', '-T'], windowsEnv(['/usr/bin/bundle.cmd'], { platform: 'linux', pathValue: '/usr/bin' }))
    expect(launch).toEqual({ file: 'bundle', args: ['exec', 'rake', '-T'], viaCmd: false })
  })
})
