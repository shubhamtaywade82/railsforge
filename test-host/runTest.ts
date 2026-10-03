/**
 * Launches a real VS Code (Electron) Extension Host with RailsForge loaded from the
 * webpack build (`dist/extension.js`) and runs test-host/suite inside it.
 *
 *   pnpm run compile && pnpm run test:host
 */
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { runTests } from '@vscode/test-electron'

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..')
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index')
  const workspace = path.resolve(extensionDevelopmentPath, 'test-host', 'fixtures', 'multi-root.code-workspace')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-host-'))

  await runTests({
    version: process.env.VSCODE_TEST_VERSION ?? 'stable',
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${userDataDir}`],
  })
}

main().catch(err => {
  console.error('Extension Host tests failed:', err)
  process.exit(1)
})
