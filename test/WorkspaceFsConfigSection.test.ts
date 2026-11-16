import { describe, it, expect, vi, afterEach } from 'vitest'
import * as vscode from 'vscode'
import { WorkspaceFsProvider, RAILSFORGE_CONFIG_SECTION } from '../src/providers/WorkspaceFsProvider'
import type { SemanticIndex } from '../src/providers/EngineAdapters'
import type { PatternCatalogAccess } from '../src/providers/PatternCatalogAccess'

type ConfigListener = (event: { affectsConfiguration(section: string): boolean }) => void

/**
 * VS Code's affectsConfiguration is case-sensitive: a change to railsForge.mcp.enabled affects "railsForge" and not
 * "railsforge". This models that, so a section name in the wrong case does not match a railsForge.* setting.
 */
function changeTo(key: string): { affectsConfiguration(section: string): boolean } {
  return {
    affectsConfiguration: section => key === section || key.startsWith(`${section}.`),
  }
}

describe('railsForge.* configuration handlers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the section name that every railsForge.* setting is declared under', () => {
    expect(RAILSFORGE_CONFIG_SECTION).toBe('railsForge')
  })

  it('runs the registered handlers when a railsForge.* setting changes', () => {
    let listener: ConfigListener | undefined
    vi.spyOn(vscode.workspace, 'onDidChangeConfiguration').mockImplementation(((handler: ConfigListener) => {
      listener = handler
      return { dispose: () => undefined }
    }) as never)

    const provider = new WorkspaceFsProvider({} as SemanticIndex, {} as PatternCatalogAccess)
    provider.activate()
    const handler = vi.fn()
    provider.onConfigChange(handler)

    listener!(changeTo('railsForge.mcp.servers'))
    listener!(changeTo('railsForge.log.level'))
    expect(handler).toHaveBeenCalledTimes(2)
    provider.dispose()
  })

  it('does not run the handlers for a setting outside railsForge', () => {
    let listener: ConfigListener | undefined
    vi.spyOn(vscode.workspace, 'onDidChangeConfiguration').mockImplementation(((handler: ConfigListener) => {
      listener = handler
      return { dispose: () => undefined }
    }) as never)

    const provider = new WorkspaceFsProvider({} as SemanticIndex, {} as PatternCatalogAccess)
    provider.activate()
    const handler = vi.fn()
    provider.onConfigChange(handler)

    listener!(changeTo('editor.fontSize'))
    expect(handler).not.toHaveBeenCalled()
    provider.dispose()
  })
})
