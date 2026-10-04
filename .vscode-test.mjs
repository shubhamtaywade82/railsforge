// Extension Host tests via @vscode/test-cli (https://code.visualstudio.com/api/working-with-extensions/testing-extension).
//   pnpm run compile && pnpm run test:host             # all labels
//   pnpm run test:host -- --label minimum              # one label
// Linux CI needs a display: xvfb-run -a pnpm run test:host
//
// Not covered here: Restricted Mode. @vscode/test-electron always appends --disable-workspace-trust, so an
// untrusted window cannot be produced through it; the trust gate is unit-tested (test/RuntimeTrust.test.ts)
// and the manifest declares capabilities.untrustedWorkspaces explicitly.
import { defineConfig } from '@vscode/test-cli'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'

const workspace = './test-host/fixtures/multi-root.code-workspace'
const freshProfile = label => fs.mkdtempSync(path.join(os.tmpdir(), `railsforge-${label}-`))
const common = { mocha: { ui: 'bdd', timeout: 60000 } }

export default defineConfig([
  {
    label: 'stable',
    files: 'out/test-host/suite/*.host.js',
    version: process.env.VSCODE_TEST_VERSION ?? 'stable',
    workspaceFolder: workspace,
    launchArgs: ['--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${freshProfile('stable')}`],
    ...common,
  },
  {
    // The engines floor: activation, LM tools and the manifest must still work on the oldest supported host.
    label: 'minimum',
    files: 'out/test-host/suite/*.host.js',
    version: '1.96.0',
    workspaceFolder: workspace,
    launchArgs: ['--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${freshProfile('minimum')}`],
    ...common,
  },
])
