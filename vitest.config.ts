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
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Not measured here: extension.ts (the activation/wiring layer, exercised by the Extension Host and
      // installed-VSIX suites), the two files that only run in a separate process, and type-only modules.
      exclude: ['src/extension.ts', 'src/mcp/server.ts', 'src/indexer/indexer.worker.ts', 'src/types/**/*.d.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      // Ratchets, set just below what is measured today so coverage can only go up. The critical,
      // security- and correctness-sensitive modules carry their own (much higher) floors.
      thresholds: {
        lines: 55, functions: 55, statements: 55, branches: 50,
        'src/workspace/{Trust,ProjectTerminal}.ts': { lines: 95, functions: 95, branches: 90, statements: 95 },
        'src/util/{WorkspacePath,ProjectProcess}.ts': { lines: 95, functions: 95, branches: 90, statements: 95 },
        'src/skills/{SafetyRules,SkillRouter,SkillContextBuilder,SkillCatalog}.ts': { lines: 95, functions: 90, branches: 75, statements: 95 },
        'src/agent/{AgentLoop,LoopTools}.ts': { lines: 95, functions: 95, branches: 85, statements: 95 },
        'src/semantic/**': { lines: 90, functions: 85, branches: 65, statements: 90 },
        'src/patch/**': { lines: 90, functions: 95, branches: 85, statements: 90 },
        'src/patterns/PatternCatalog.ts': { lines: 95, functions: 95, branches: 70, statements: 95 },
        'src/diagnostics/Diagnostics.ts': { lines: 90, functions: 95, branches: 70, statements: 90 },
        // Honest floor for a file that still needs work (diff-preview/apply paths beyond create/overwrite).
        'src/chat/ChatDiffApplier.ts': { lines: 50, functions: 70, branches: 30, statements: 50 },
      },
    },
  },
})
