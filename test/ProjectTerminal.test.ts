import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createTerminal: vi.fn((options: unknown) => ({ options, sendText: vi.fn() })),
  startDebugging: vi.fn(async () => true),
}))

vi.mock('vscode', () => ({
  window: { createTerminal: h.createTerminal },
  debug: { startDebugging: h.startDebugging },
}))

import { createProjectTerminal, sendToTerminal, startProjectDebugging } from '../src/workspace/ProjectTerminal'
import { UntrustedWorkspaceError, setTrustProvider } from '../src/workspace/Trust'

afterEach(() => {
  setTrustProvider(() => true)
  vi.clearAllMocks()
})

describe('trusted workspace', () => {
  it('opens terminals (by name or options), types into them and starts debug sessions', async () => {
    const byName = createProjectTerminal('RailsForge Console')
    const byOptions = createProjectTerminal({ name: 'RailsForge Release', cwd: '/p' })
    expect(h.createTerminal).toHaveBeenNthCalledWith(1, 'RailsForge Console')
    expect(h.createTerminal).toHaveBeenNthCalledWith(2, { name: 'RailsForge Release', cwd: '/p' })

    sendToTerminal(byName, 'bin/rails console', true)
    expect(byName.sendText).toHaveBeenCalledWith('bin/rails console', true)
    sendToTerminal(byOptions, 'rake release')
    expect(byOptions.sendText).toHaveBeenCalledWith('rake release', undefined)

    await expect(startProjectDebugging(undefined, { type: 'rdbg', name: 'x', request: 'launch' })).resolves.toBe(true)
    expect(h.startDebugging).toHaveBeenCalledOnce()
  })
})

describe('untrusted workspace', () => {
  it('refuses all three before touching VS Code', () => {
    setTrustProvider(() => false)
    expect(() => createProjectTerminal('x')).toThrow(UntrustedWorkspaceError)
    expect(() => sendToTerminal({ sendText: vi.fn() } as never, 'rm -rf /')).toThrow(UntrustedWorkspaceError)
    expect(() => startProjectDebugging(undefined, { type: 'rdbg', name: 'x', request: 'launch' })).toThrow(UntrustedWorkspaceError)
    expect(h.createTerminal).not.toHaveBeenCalled()
    expect(h.startDebugging).not.toHaveBeenCalled()
  })

  it('does not type into an existing terminal either', () => {
    const terminal = { sendText: vi.fn() }
    setTrustProvider(() => false)
    expect(() => sendToTerminal(terminal as never, 'bundle exec rake')).toThrow()
    expect(terminal.sendText).not.toHaveBeenCalled()
  })
})
