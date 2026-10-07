#!/usr/bin/env node
/**
 * restricted-host-test - launches a real VS Code with workspace trust ENABLED on a workspace that contains
 * fake Ruby tools, and runs test-host/restricted against it.
 *
 *   node scripts/restricted-host-test.mjs             # untrusted: nothing may execute
 *   node scripts/restricted-host-test.mjs --trusted   # control: the same commands DO run the fake tools
 *
 * (@vscode/test-electron always passes --disable-workspace-trust, so it cannot produce Restricted Mode;
 * this script spawns the downloaded VS Code directly.) POSIX only: the fake tools are shell scripts.
 */
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform === 'win32') { console.log('restricted-host-test: skipped on Windows (POSIX shell shims)'); process.exit(0) }

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const trusted = process.argv.includes('--trusted')
const runner = path.join(repo, 'out', 'test-host', 'restricted', 'index.js')
if (!fs.existsSync(runner)) { console.error(`restricted-host-test: ${runner} missing — run "tsc -p tsconfig.host.json" first`); process.exit(1) }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-restricted-'))
const workspace = path.join(tmp, 'rails_a')
const shims = path.join(tmp, 'shims')
const markers = path.join(tmp, 'markers')
fs.cpSync(path.join(repo, 'test-host', 'fixtures', 'rails_a'), workspace, { recursive: true })
fs.mkdirSync(shims, { recursive: true })
fs.mkdirSync(markers, { recursive: true })
// Every Ruby tool RailsForge might launch, as an executable that proves it ran. bin/ stubs are preferred by the
// toolchain resolver, so they go in the workspace too; PATH covers bare/`bundle exec` forms.
const tools = ['bundle', 'rubocop', 'brakeman', 'rake', 'rails', 'rspec', 'bundle-audit', 'steep', 'reek', 'flog', 'flay', 'debride', 'standardrb', 'rbs', 'rdbg', 'mise', 'asdf', 'rbenv']
const script = name => `#!/bin/sh\n# marker-only stand-in for ${name}\ntouch "${markers}/${name}"\n# \`bundle exec <tool>\`: record the tool too\nif [ "${name}" = "bundle" ] && [ "$1" = "exec" ] && [ -n "$2" ]; then touch "${markers}/$2"; fi\nexit 0\n`
for (const name of tools) {
  fs.writeFileSync(path.join(shims, name), script(name), { mode: 0o755 })
}
fs.mkdirSync(path.join(workspace, 'bin'), { recursive: true })
for (const name of ['rubocop', 'brakeman', 'rake', 'rails', 'rspec', 'steep']) {
  fs.writeFileSync(path.join(workspace, 'bin', name), script(name), { mode: 0o755 })
}
for (const f of ['Gemfile', 'Rakefile', '.rubocop.yml']) {
  if (!fs.existsSync(path.join(workspace, f))) { fs.writeFileSync(path.join(workspace, f), f === 'Gemfile' ? "source 'https://rubygems.org'\ngem 'rails'\ngem 'brakeman'\n" : '') }
}
fs.writeFileSync(path.join(workspace, 'Gemfile.lock'), 'GEM\n  specs:\n    rails (8.0.1)\n    brakeman (7.0.0)\n\nPLATFORMS\n  ruby\n\nDEPENDENCIES\n  rails\n  brakeman\n')

const userData = path.join(tmp, 'user-data')
fs.mkdirSync(path.join(userData, 'User'), { recursive: true })
fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({
  // Trust ON: an unknown folder is Restricted without a prompt. The control run turns the whole feature off,
  // which makes every workspace trusted — the only difference between the two runs.
  'security.workspace.trust.enabled': !trusted,
  'security.workspace.trust.startupPrompt': 'never',
  'security.workspace.trust.banner': 'never',
  'security.workspace.trust.untrustedFiles': 'open',
  'railsForge.runtime.introspection.enabled': false,
  'telemetry.telemetryLevel': 'off',
}, null, 2))

const exe = await downloadAndUnzipVSCode(process.env.VSCODE_TEST_VERSION ?? 'stable')
const args = [
  workspace,
  '--no-sandbox', '--disable-gpu-sandbox', '--disable-updates', '--skip-welcome', '--skip-release-notes', '--no-cached-data',
  `--extensionDevelopmentPath=${repo}`, `--extensionTestsPath=${runner}`,
  `--user-data-dir=${userData}`, `--extensions-dir=${path.join(tmp, 'extensions')}`, '--disable-extensions',
]
const env = {
  ...process.env,
  PATH: `${shims}${path.delimiter}${process.env.PATH}`,
  RAILSFORGE_SHIM_MARKERS: markers,
  RAILSFORGE_EXPECT_TRUSTED: trusted ? '1' : '0',
}

console.log(`restricted-host-test: ${trusted ? 'CONTROL (trusted)' : 'UNTRUSTED'} run in ${workspace}`)
const child = spawn(exe, args, { env, stdio: ['ignore', 'inherit', 'inherit'] })
const code = await new Promise(resolve => child.on('close', resolve))
fs.rmSync(tmp, { recursive: true, force: true })
if (code !== 0) { console.error(`restricted-host-test: FAILED (exit ${code})`); process.exit(1) }
console.log('restricted-host-test: OK')
