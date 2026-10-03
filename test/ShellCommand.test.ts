import { describe, it, expect } from 'vitest'
import { shellKindFromPath, quoteArg, buildCommandLine, hasPathSegment } from '../src/util/ShellCommand'

describe('ShellCommand', () => {
  it('detects the shell from its path', () => {
    expect(shellKindFromPath('C:\\Windows\\System32\\cmd.exe')).toBe('cmd')
    expect(shellKindFromPath('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('powershell')
    expect(shellKindFromPath('/bin/zsh')).toBe('posix')
    expect(shellKindFromPath(undefined, 'win32')).toBe('powershell')
    expect(shellKindFromPath(undefined, 'linux')).toBe('posix')
  })

  it('quotes per shell, including embedded quotes and spaces', () => {
    expect(quoteArg("it's", 'posix')).toBe("'it'\\''s'")
    expect(quoteArg("it's", 'powershell')).toBe("'it''s'")
    expect(quoteArg('C:\\My Rails App\\a.rb', 'cmd')).toBe('"C:\\My Rails App\\a.rb"')
    expect(quoteArg('a"b', 'cmd')).toBe('"a""b"')
  })

  it('builds a command line', () => {
    expect(buildCommandLine('bundle', ['exec', 'rspec', 'C:\\My App\\x_spec.rb:3'], 'cmd'))
      .toBe('bundle "exec" "rspec" "C:\\My App\\x_spec.rb:3"')
  })

  it('finds path segments with either separator', () => {
    expect(hasPathSegment('C:\\app\\spec\\models\\u_spec.rb', 'spec')).toBe(true)
    expect(hasPathSegment('/app/inspect/x.rb', 'spec')).toBe(false)
  })
})
