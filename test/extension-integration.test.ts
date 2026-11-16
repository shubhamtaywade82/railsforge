import { describe, it, expect } from 'vitest'

/**
 * Integration test that verifies the extension module loads without error.
 * This catches regressions like missing imports, unhandled sync I/O crashes,
 * and circular dependency issues.
 *
 * We don't call activate() here because it requires a full vscode mock with
 * workspace folders, configuration, etc. The unit tests and manual testing
 * cover activation behavior. This test ensures the module graph is valid.
 */
/**
 * A cold import of the whole extension module graph takes about 2.3 s on its own (measured in isolation, with and
 * without coverage). Under the full parallel run, with every worker loading modules at once, it can exceed the 5 s
 * default. This test gets an explicit budget for that cold import; its assertions are unchanged.
 */
const IMPORT_TIMEOUT_MS = 30_000

describe('extension module integration', () => {
  it('extension module can be imported without errors', async () => {
    // Dynamically import the compiled extension to verify the module graph
    // resolves without missing imports or circular dependency crashes.
    const mod = await import('../src/extension')
    expect(typeof mod.activate).toBe('function')
    expect(typeof mod.deactivate).toBe('function')
    expect(typeof mod.diffLines).toBe('function')
    expect(typeof mod.filterFixHunks).toBe('function')
    expect(typeof mod.applyHunks).toBe('function')
  }, IMPORT_TIMEOUT_MS)

  it('exports all diff utility functions used by tests', async () => {
    const mod = await import('../src/extension')
    // Verify the exported diff functions are callable (used by AiFixDiff.test.ts)
    const result = mod.diffLines('a\nb\nc', 'a\nX\nc')
    expect(result).toHaveLength(1)
    expect(result[0].startLine).toBe(1)
    expect(result[0].inserted).toEqual(['X'])
  })
})
