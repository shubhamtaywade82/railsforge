import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { hasPrebuild, missingPrebuilds } from '../src/indexer/nativeSupport'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-prebuilds-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

function layout(files: Record<string, string[]>): void {
  for (const [mod, entries] of Object.entries(files)) {
    for (const e of entries) {
      const p = path.join(tmp, mod, 'prebuilds', e)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, '')
    }
  }
}

describe('prebuild detection', () => {
  it('matches both "<platform>-<arch>.node" files and "<platform>-<arch>" directories', () => {
    layout({
      'better-sqlite3': ['linux-x64.node', 'darwin-arm64.node'],
      'tree-sitter': ['linux-x64/tree-sitter.node'],
      'tree-sitter-ruby': ['linux-x64/tree-sitter-ruby.node', 'linux-arm64/tree-sitter-ruby.node'],
    })
    expect(hasPrebuild(tmp, 'better-sqlite3', 'linux', 'x64')).toBe(true)
    expect(hasPrebuild(tmp, 'tree-sitter', 'linux', 'x64')).toBe(true)
    expect(hasPrebuild(tmp, 'tree-sitter', 'linux', 'arm64')).toBe(false)
  })

  it('does not confuse similar prefixes (linux-x64 vs linuxmusl-x64)', () => {
    layout({ 'better-sqlite3': ['linuxmusl-x64.node'] })
    expect(hasPrebuild(tmp, 'better-sqlite3', 'linux', 'x64')).toBe(true) // from the earlier glibc file
    fs.rmSync(path.join(tmp, 'better-sqlite3', 'prebuilds', 'linux-x64.node'))
    expect(hasPrebuild(tmp, 'better-sqlite3', 'linux', 'x64')).toBe(false)
  })

  it('lists exactly the modules lacking a binary, and treats a missing module as missing', () => {
    expect(missingPrebuilds(tmp, 'linux', 'arm64').sort()).toEqual(['better-sqlite3', 'tree-sitter'])
    expect(missingPrebuilds(path.join(tmp, 'nowhere'), 'linux', 'x64').sort()).toEqual(['better-sqlite3', 'tree-sitter', 'tree-sitter-ruby'])
  })
})
