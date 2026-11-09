/**
 * Runs one command that launches VS Code for the host tests, and runs it once more if it fails at the VS Code download.
 *
 * @vscode/test-electron fetches the VS Code release list and the build with a fixed 15 s request timeout. On a busy
 * runner that request can time out before a single test starts (CI run 42562874232, macOS x64). That is a network
 * fault, not a test result, so it is retried once. Every other failure, including a failing test, is returned as it
 * is and is never retried.
 *
 * Usage: node scripts/run-with-download-retry.mjs <command> [args...]
 */

import { spawn } from 'node:child_process'

const DOWNLOAD_TIMEOUT = '@vscode/test-electron request timeout out after'

function runOnce(command, args) {
  return new Promise((resolve, reject) => {
    let output = ''
    const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    child.stdout.on('data', chunk => {
      process.stdout.write(chunk)
      output += chunk
    })
    child.stderr.on('data', chunk => {
      process.stderr.write(chunk)
      output += chunk
    })
    child.on('error', reject)
    child.on('close', code => resolve({ code: code ?? 1, output }))
  })
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!command) {
    console.error('usage: node scripts/run-with-download-retry.mjs <command> [args...]')
    return 2
  }
  const first = await runOnce(command, args)
  if (first.code === 0 || !first.output.includes(DOWNLOAD_TIMEOUT)) {return first.code}
  console.log('::warning::The VS Code download timed out before the host tests started. Running the command once more.')
  return (await runOnce(command, args)).code
}

main().then(
  code => {
    process.exitCode = code
  },
  error => {
    console.error(error)
    process.exitCode = 1
  },
)
