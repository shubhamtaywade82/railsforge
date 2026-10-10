import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { TRUST_GATED_COMMANDS } from '../src/workspace/Trust'

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as {
  capabilities: { untrustedWorkspaces: { supported: unknown; description: string; restrictedConfigurations?: string[] } }
  contributes: { commands: Array<{ command: string; enablement?: string }>; configuration: { properties: Record<string, unknown> } | Array<{ properties: Record<string, unknown> }> }
}
const props = (Array.isArray(pkg.contributes.configuration) ? Object.assign({}, ...pkg.contributes.configuration.map(c => c.properties)) : pkg.contributes.configuration.properties) as Record<string, unknown>

describe('Restricted Mode manifest', () => {
  const caps = pkg.capabilities.untrustedWorkspaces

  it('declares limited support with an honest description', () => {
    expect(caps.supported).toBe('limited')
    expect(caps.description).toMatch(/read-only/i)
    expect(caps.description).toMatch(/RuboCop/)
  })

  it('restricts every setting that chooses a program, a script path or a network target', () => {
    const must = [
      'railsForge.ollama.host', 'railsForge.ai.provider', 'railsForge.ai.openai.baseUrl',
      'railsForge.apidock.baseUrl', 'railsForge.rubydoc.baseUrl', 'railsForge.devdocs.baseUrl', 'railsForge.devdocs.dataBaseUrl',
      'railsForge.ruby.versionManager', 'railsForge.testing.framework',
      'railsForge.rubocop.autocorrectOnSave', 'railsForge.brakeman.scanOnSave', 'railsForge.types.steepEnabled', 'railsForge.types.steepScanOnSave',
      'railsForge.analyzers.enabled', 'railsForge.analyzers.paths', 'railsForge.runtime.introspection.enabled', 'railsForge.skills.extraPaths',
    ]
    for (const key of must) {expect(caps.restrictedConfigurations, key).toContain(key)}
  })

  it('every restricted setting exists (a typo would silently protect nothing)', () => {
    for (const key of caps.restrictedConfigurations ?? []) {expect(props[key], `unknown setting ${key}`).toBeDefined()}
    expect(new Set(caps.restrictedConfigurations).size).toBe(caps.restrictedConfigurations?.length)
  })

  it('every command that runs project code is disabled in Restricted Mode, and nothing else is', () => {
    const contributed = new Map(pkg.contributes.commands.map(c => [c.command, c]))
    for (const id of TRUST_GATED_COMMANDS) {
      expect(contributed.get(id), `${id} is not contributed`).toBeDefined()
      expect(contributed.get(id)?.enablement, id).toBe('isWorkspaceTrusted')
    }
    const gated = new Set(TRUST_GATED_COMMANDS)
    const stray = pkg.contributes.commands.filter(c => c.enablement === 'isWorkspaceTrusted' && !gated.has(c.command)).map(c => c.command)
    expect(stray, 'enablement without an entry in TRUST_GATED_COMMANDS').toEqual([])
  })
})
