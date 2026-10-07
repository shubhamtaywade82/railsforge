/**
 * Static guard: the Restricted Mode gate only works if nothing bypasses it. These tests fail when someone
 * adds a raw process/terminal/debug launch outside the wrappers, with a message saying where and why.
 */
import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(__dirname, '..', 'src')

function sourceFiles(dir = SRC): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name)
    return e.isDirectory() ? sourceFiles(full) : e.name.endsWith('.ts') ? [full] : []
  })
}
const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join('/')
const read = (f: string): string => fs.readFileSync(f, 'utf8')

/** Code without comments and string/template contents, so mentions in prose never count. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const allowed = (patterns: RegExp, allowedFiles: readonly string[]): string[] =>
  sourceFiles().filter(f => patterns.test(code(read(f))) && !allowedFiles.includes(rel(f))).map(rel)

describe('Restricted Mode cannot be bypassed by a new call site', () => {
  it('only the gated wrappers (and two parse-only/OS-only helpers) import child_process', () => {
    // RubySyntax: `ruby -c` parses, never executes. nativeSupport: asks the OS for its libc version.
    // mcp/server.ts: the standalone stdio server (a separate process that only reads files).
    const offenders = allowed(/from\s+['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]\s*\)/, [
      'util/ProjectProcess.ts', 'util/RubySyntax.ts', 'indexer/nativeSupport.ts', 'mcp/server.ts',
    ])
    expect(offenders, 'import execFileAsync/spawnProject from util/ProjectProcess instead').toEqual([])
  })

  it('terminals, debug sessions and task executions go through ProjectTerminal / the guarded task provider', () => {
    const offenders = allowed(/\.createTerminal\(|\.sendText\(|\.startDebugging\(|\.executeTask\(/, ['workspace/ProjectTerminal.ts'])
    expect(offenders, 'use createProjectTerminal / sendToTerminal / startProjectDebugging').toEqual([])
  })

  it('ProcessExecution/ShellExecution are only built where the provider is trust-gated', () => {
    const offenders = allowed(/new\s+vscode\.(?:ProcessExecution|ShellExecution|CustomExecution)\(/, ['tasks/RailsTaskProvider.ts'])
    expect(offenders).toEqual([])
    const provider = read(path.join(SRC, 'tasks', 'RailsTaskProvider.ts'))
    expect(provider).toMatch(/isWorkspaceTrusted\(\)/)
  })

  it('every wrapper actually asserts trust', () => {
    expect(read(path.join(SRC, 'util', 'ProjectProcess.ts')).match(/assertTrusted\(/g)?.length).toBeGreaterThanOrEqual(2)
    expect(read(path.join(SRC, 'workspace', 'ProjectTerminal.ts')).match(/assertTrusted\(/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('the trust provider is installed before anything else runs in activate()', () => {
    const ext = read(path.join(SRC, 'extension.ts'))
    const activate = ext.slice(ext.indexOf('export function activate('))
    const provider = activate.indexOf('setTrustProvider(')
    expect(provider).toBeGreaterThan(-1)
    // ...and before the first provider/tool that could execute anything is constructed.
    for (const marker of ['new RuboCopProvider', 'new BrakemanProvider', 'new RakeTaskIndexer', 'new TestExplorerController']) {
      const at = activate.indexOf(marker)
      if (at !== -1) {expect(provider, `${marker} is created before the trust provider is installed`).toBeLessThan(at)}
    }
  })
})
