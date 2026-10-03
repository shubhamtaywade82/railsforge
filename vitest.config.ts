import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'test/__mocks__/vscode.ts'),
    },
  },
  test: {
    environment: 'node',
    // Test files that use better-sqlite3 (a native N-API addon) crashed CI's runner
    // with "Worker exited unexpectedly" under the default 'threads' pool, which loads
    // each test file's native addon into a separate worker_threads Worker of the same
    // process — a known-flaky combination for native modules on some platforms. 'forks'
    // isolates each test file in its own child process instead, sidestepping it entirely.
    pool: 'forks',
    // test-host/ runs inside a real VS Code Extension Host (mocha), not vitest.
    exclude: ['**/node_modules/**', 'test-host/**', 'out/**', 'dist/**'],
  },
})
