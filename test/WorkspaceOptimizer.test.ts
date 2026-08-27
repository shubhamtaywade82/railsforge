const { mockLoggerInfo } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
}))

vi.mock('../src/util/Logger', () => ({
  Logger: { info: mockLoggerInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from 'vscode'
import {
  isOptimizationNeeded,
  mergeObjectConfig,
  mergeArrayConfig,
  optimizeRailsWorkspace,
  handleWorkspaceAutoOptimization,
  RECOMMENDED_WATCHER_EXCLUDES,
  RECOMMENDED_SEARCH_EXCLUDES,
  RECOMMENDED_RUBY_LSP_EXCLUDES,
} from '../src/workspace/WorkspaceOptimizer'

describe('WorkspaceOptimizer', () => {
  const configUpdates: Array<{ section: string; key: string; value: unknown; target: unknown }> = []
  const inspectedKeys: Record<string, unknown> = {}

  beforeEach(() => {
    configUpdates.length = 0
    for (const k of Object.keys(inspectedKeys)) { delete inspectedKeys[k] }
    mockLoggerInfo.mockReset()
  })

  // Mock vscode.workspace.getConfiguration to track update calls
  function setupMockConfig(workspaceValues?: Record<string, unknown>) {
    return (section?: string) => ({
      get: <T>(key: string, defaultValue?: T): T => (workspaceValues?.[`${section}.${key}`] as T) ?? (defaultValue as T),
      inspect: <T>(key: string) => ({ workspaceValue: (workspaceValues?.[`inspect.${section}.${key}`] as T) ?? undefined }),
      update: (key: string, value: unknown, target: unknown) => {
        configUpdates.push({ section: section ?? '', key, value, target })
        return Promise.resolve()
      },
    })
  }

  describe('isOptimizationNeeded', () => {
    it('returns true when watcher configuration is undefined', () => {
      expect(isOptimizationNeeded(undefined, undefined)).toBe(true)
    })

    it('returns true when critical watcher keys are missing', () => {
      const watchers = { '**/.git/**': true }
      expect(isOptimizationNeeded(watchers, RECOMMENDED_SEARCH_EXCLUDES)).toBe(true)
    })

    it('returns true when critical search keys are missing', () => {
      const watchers = {
        '**/tmp/**': true,
        '**/log/**': true,
        '**/storage/**': true,
      }
      expect(isOptimizationNeeded(watchers, {})).toBe(true)
    })

    it('returns false when critical watcher and search keys are already present', () => {
      const watchers = {
        '**/tmp/**': true,
        '**/log/**': true,
        '**/storage/**': true,
      }
      const search = {
        '**/tmp': true,
        '**/log': true,
      }
      expect(isOptimizationNeeded(watchers, search)).toBe(false)
    })
  })

  describe('mergeObjectConfig', () => {
    it('adds recommended settings to empty object', () => {
      const merged = mergeObjectConfig({}, RECOMMENDED_WATCHER_EXCLUDES)
      expect(merged['**/tmp/**']).toBe(true)
      expect(merged['**/log/**']).toBe(true)
      expect(merged['**/node_modules/**']).toBe(true)
    })

    it('preserves existing custom user settings without overwriting', () => {
      const existing = {
        '**/custom_dir/**': true,
        '**/tmp/**': false,
      }
      const merged = mergeObjectConfig(existing, RECOMMENDED_WATCHER_EXCLUDES)
      expect(merged['**/custom_dir/**']).toBe(true)
      expect(merged['**/tmp/**']).toBe(false)
      expect(merged['**/log/**']).toBe(true)
    })

    it('handles undefined existing config by starting from empty object', () => {
      const merged = mergeObjectConfig(undefined, RECOMMENDED_WATCHER_EXCLUDES)
      expect(merged['**/tmp/**']).toBe(true)
      expect(merged['**/log/**']).toBe(true)
      expect(merged['**/node_modules/**']).toBe(true)
    })
  })

  describe('mergeArrayConfig', () => {
    it('combines array items without duplicates', () => {
      const existing = ['**/custom/**', '**/tmp/**']
      const merged = mergeArrayConfig(existing, RECOMMENDED_RUBY_LSP_EXCLUDES)
      expect(merged).toContain('**/custom/**')
      expect(merged).toContain('**/tmp/**')
      expect(merged).toContain('**/db/migrate/**')
      expect(merged.filter(x => x === '**/tmp/**')).toHaveLength(1)
    })

    it('handles undefined existing array by using empty array', () => {
      const merged = mergeArrayConfig(undefined, RECOMMENDED_RUBY_LSP_EXCLUDES)
      expect(merged).toContain('**/tmp/**')
      expect(merged).toContain('**/vendor/**')
      expect(merged).toContain('**/db/migrate/**')
    })
  })

  describe('optimizeRailsWorkspace', () => {
    it('updates files.watcherExclude, search.exclude, rubyLsp.indexing.excludedPatterns, and rubyLsp.rubocop.serverMode', async () => {
      const origGetConfig = vscode.workspace.getConfiguration
      vscode.workspace.getConfiguration = setupMockConfig()

      await optimizeRailsWorkspace(vscode.ConfigurationTarget.Workspace)

      const updatedSections = configUpdates.map(u => `${u.section}.${u.key}`)
      expect(updatedSections).toContain('files.watcherExclude')
      expect(updatedSections).toContain('search.exclude')
      expect(updatedSections).toContain('rubyLsp.indexing.excludedPatterns')
      expect(updatedSections).toContain('rubyLsp.rubocop.serverMode')
      expect(configUpdates[3].value).toBe(true) // rubocop.serverMode = true

      vscode.workspace.getConfiguration = origGetConfig
    })

    it('merges recommended watcher excludes into current config', async () => {
      const origGetConfig = vscode.workspace.getConfiguration
      vscode.workspace.getConfiguration = setupMockConfig({
        'files.watcherExclude': { '**/tmp/**': true },
      })

      await optimizeRailsWorkspace()

      const watcherUpdate = configUpdates.find(u => u.key === 'watcherExclude')
      expect(watcherUpdate?.value).toHaveProperty('**/tmp/**', true)
      expect(watcherUpdate?.value).toHaveProperty('**/log/**', true)

      vscode.workspace.getConfiguration = origGetConfig
    })
  })

  describe('handleWorkspaceAutoOptimization', () => {
    it('returns false when mode is disabled', async () => {
      const result = await handleWorkspaceAutoOptimization('disabled', true)
      expect(result).toBe(false)
    })

    it('returns false when hasRails is false', async () => {
      const result = await handleWorkspaceAutoOptimization('auto', false)
      expect(result).toBe(false)
    })

    it('returns false when workspace is already optimized', async () => {
      const origGetConfig = vscode.workspace.getConfiguration
      vscode.workspace.getConfiguration = setupMockConfig({
        'inspect.files.watcherExclude': {
          '**/tmp/**': true,
          '**/log/**': true,
          '**/storage/**': true,
        },
        'inspect.search.exclude': { '**/tmp': true, '**/log': true },
      })

      const result = await handleWorkspaceAutoOptimization('auto', true)
      expect(result).toBe(false)

      vscode.workspace.getConfiguration = origGetConfig
    })

    it('auto-optimizes when mode is auto and optimization is needed', async () => {
      const origGetConfig = vscode.workspace.getConfiguration
      vscode.workspace.getConfiguration = setupMockConfig({
        'inspect.files.watcherExclude': {},
        'inspect.search.exclude': {},
      })

      const result = await handleWorkspaceAutoOptimization('auto', true)
      expect(result).toBe(true)
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.stringContaining('Automatically optimized workspace'),
      )

      vscode.workspace.getConfiguration = origGetConfig
    })

    it('prompts and optimizes when user clicks Optimize Workspace', async () => {
      const origGetConfig = vscode.workspace.getConfiguration
      const origShowInfo = vscode.window.showInformationMessage
      vscode.workspace.getConfiguration = setupMockConfig({
        'inspect.files.watcherExclude': {},
        'inspect.search.exclude': {},
      })
      vscode.window.showInformationMessage = vi.fn()
        .mockResolvedValueOnce('Optimize Workspace')
        .mockResolvedValueOnce(undefined)

      const result = await handleWorkspaceAutoOptimization('prompt', true)
      expect(result).toBe(true)
      expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2)

      vscode.workspace.getConfiguration = origGetConfig
      vscode.window.showInformationMessage = origShowInfo
    })

    it('returns false when user clicks Not Now in prompt', async () => {
      const origGetConfig = vscode.workspace.getConfiguration
      const origShowInfo = vscode.window.showInformationMessage
      vscode.workspace.getConfiguration = setupMockConfig({
        'inspect.files.watcherExclude': {},
        'inspect.search.exclude': {},
      })
      vscode.window.showInformationMessage = vi.fn().mockResolvedValueOnce('Not Now')

      const result = await handleWorkspaceAutoOptimization('prompt', true)
      expect(result).toBe(false)

      vscode.workspace.getConfiguration = origGetConfig
      vscode.window.showInformationMessage = origShowInfo
    })
  })
})
