#!/usr/bin/env node
/**
 * vsix-smoke - installs the *packaged* VSIX into a clean VS Code (fresh user-data and extensions
 * dirs) and runs test-host/vsix against the installed copy. Catches what source-tree tests cannot:
 * missing files in the package, native prebuilds absent from the bundle, wrong publisher/id,
 * activation failures once installed.
 *
 *   pnpm run vsix-smoke [-- path/to/railsforge.vsix]      # default ./railsforge.vsix
 *   VSCODE_TEST_VERSION=1.96.0 pnpm run vsix-smoke        # pick the VS Code build (default: stable)
 */
import { downloadAndUnzipVSCode, runTests, runVSCodeCommand } from '@vscode/test-electron'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vsix = path.resolve(process.argv[2] ?? path.join(repo, 'railsforge.vsix'))
const version = process.env.VSCODE_TEST_VERSION ?? 'stable'
const MAX_VSIX_MB = Number(process.env.RAILSFORGE_MAX_VSIX_MB ?? 40)

const die = msg => { console.error(`vsix-smoke: ${msg}`); process.exit(1) }

if (!fs.existsSync(vsix)) { die(`${vsix} not found — run "pnpm run vsce-package" first`) }
const runner = path.join(repo, 'out', 'test-host', 'vsix', 'index.js')
if (!fs.existsSync(runner)) { die(`${runner} not found — run "tsc -p tsconfig.host.json" first`) }

const sizeMb = fs.statSync(vsix).size / 1024 / 1024
console.log(`vsix-smoke: ${path.basename(vsix)} is ${sizeMb.toFixed(1)} MB (limit ${MAX_VSIX_MB} MB)`)
if (sizeMb > MAX_VSIX_MB) { die(`VSIX exceeds ${MAX_VSIX_MB} MB`) }

const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-vsix-smoke-'))
const extensionsDir = path.join(tmp, 'extensions')
const userDataDir = path.join(tmp, 'user-data')
const harness = path.join(tmp, 'harness')
const workspace = path.join(tmp, 'rails_a')
fs.mkdirSync(harness, { recursive: true })
// test-electron always passes --extensionDevelopmentPath; give it an inert extension so the
// only RailsForge copy VS Code loads is the installed one.
fs.writeFileSync(path.join(harness, 'package.json'), JSON.stringify({
  name: 'railsforge-vsix-smoke-harness', publisher: 'railsforge-test', version: '0.0.0', engines: { vscode: '^1.96.0' },
}))
fs.cpSync(path.join(repo, 'test-host', 'fixtures', 'rails_a'), workspace, { recursive: true })

try {
  const vscodeExecutablePath = await downloadAndUnzipVSCode(version)
  const profile = [`--extensions-dir=${extensionsDir}`, `--user-data-dir=${userDataDir}`]

  const install = await runVSCodeCommand(['--install-extension', vsix, '--force', ...profile], { vscodeExecutablePath })
  process.stdout.write(install.stdout)
  if (!/successfully installed/i.test(install.stdout + install.stderr)) { die(`install did not report success:\n${install.stdout}\n${install.stderr}`) }

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: harness,
    extensionTestsPath: runner,
    launchArgs: [workspace, ...profile, '--disable-workspace-trust', '--disable-updates', '--skip-welcome', '--skip-release-notes'],
    extensionTestsEnv: {
      RAILSFORGE_SMOKE_EXTENSIONS_DIR: extensionsDir,
      RAILSFORGE_SMOKE_VERSION: manifest.version,
      RAILSFORGE_SMOKE_WORKSPACE: workspace,
    },
  })
  console.log('vsix-smoke: OK')
} catch (err) {
  console.error(`vsix-smoke: FAILED — ${err instanceof Error ? err.message : err}`)
  process.exitCode = 1
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
