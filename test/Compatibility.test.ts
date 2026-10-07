import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { AST_INDEX_NATIVE_MODULES, hasPrebuild } from '../src/indexer/nativeSupport'

const repo = path.resolve(__dirname, '..')
const doc = fs.readFileSync(path.join(repo, 'docs', 'compatibility.md'), 'utf8')
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')) as { engines: { vscode: string } }
const ci = fs.readFileSync(path.join(repo, '.github', 'workflows', 'ci.yml'), 'utf8')

/** Rows of the platforms table: `platform` → { ast: boolean }. */
function platformRows(): Map<string, { ast: boolean }> {
  const rows = new Map<string, { ast: boolean }>()
  for (const line of doc.split('\n')) {
    const m = /^\| `((?:linux|win32|darwin)-[a-z0-9]+)` \| [^|]+ \| ([^|]+) \|/.exec(line)
    if (m) {rows.set(m[1], { ast: m[2].trim().startsWith('✅') })}
  }
  return rows
}

describe('docs/compatibility.md', () => {
  it('states the engines.vscode floor from package.json', () => {
    expect(doc).toContain(`\`${pkg.engines.vscode}\``)
  })

  it('lists every CI runner that the workflow actually uses for the platform matrix', () => {
    for (const runner of ['windows-latest', 'macos-latest', 'macos-15-intel', 'ubuntu-latest']) {
      expect(ci, `${runner} not in ci.yml`).toContain(runner)
      expect(doc, `${runner} not in docs`).toContain(runner)
    }
  })

  const nm = path.join(repo, 'node_modules')
  it.skipIf(!AST_INDEX_NATIVE_MODULES.every(m => fs.existsSync(path.join(nm, m, 'prebuilds'))))(
    'AST-index column matches the prebuilt binaries actually shipped',
    () => {
      const rows = platformRows()
      expect(rows.size).toBeGreaterThanOrEqual(6)
      for (const [key, { ast }] of rows) {
        const [platform, arch] = key.split('-')
        const shipped = AST_INDEX_NATIVE_MODULES.every(m => hasPrebuild(nm, m, platform, arch))
        expect(ast, `${key}: doc says AST ${ast ? 'supported' : 'unsupported'} but prebuilds say ${shipped}`).toBe(shipped)
      }
    },
  )
})
