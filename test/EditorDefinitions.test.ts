import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { EDITOR_CWD_MIN_VERSION, hostSupportsEditorCwd, planEditorDefinitions } from '../src/mcp/external/EditorDefinitions'
import { ExternalServerSpec } from '../src/mcp/external/ExternalServerConfig'

const spec = (over: Partial<ExternalServerSpec> = {}): ExternalServerSpec => ({
  id: 'ask-ruby',
  enabled: true,
  transport: 'stdio',
  command: 'ask-ruby-harness-mcp',
  args: ['--stdio'],
  env: { MODE: 'read' },
  allowTools: ['read_model'],
  exposeToEditor: true,
  ...over,
})

const modern = '1.146.0'

describe('hostSupportsEditorCwd: the version gate, verified against shipped VS Code bundles', () => {
  it('is 1.105.0, the first release whose MCP definitions honour cwd', () => {
    expect(EDITOR_CWD_MIN_VERSION).toEqual([1, 105, 0])
  })

  it.each([
    ['1.96.0', false, 'no MCP definition API at all'],
    ['1.100.0', false, 'MCP API present, but cwd not honoured'],
    ['1.104.9', false, 'just below the gate'],
    ['1.105.0', true, 'the gate'],
    ['1.105.0-insider', true, 'an insiders build of the gate version'],
    ['1.146.0', true, 'a current release'],
    ['2.0.0', true, 'a later major version'],
    ['0.9.0', false, 'an older major version'],
    ['', false, 'an unknown version is not supported'],
    [undefined, false, 'a missing version is not supported'],
    ['not-a-version', false, 'an unreadable version is not supported'],
  ])('%s -> %s (%s)', (version, expected) => {
    expect(hostSupportsEditorCwd(version as string | undefined)).toBe(expected)
  })
})

describe('planEditorDefinitions', () => {
  it('offers nothing to the editor unless the server is opted in with exposeToEditor', () => {
    const plan = planEditorDefinitions({ servers: [spec({ exposeToEditor: false })], roots: ['/project'], trusted: true, hostVersion: modern })
    expect(plan.definitions).toEqual([])
    expect(plan.problems).toEqual([])
  })

  it('offers nothing when the server is disabled', () => {
    const plan = planEditorDefinitions({ servers: [spec({ enabled: false })], roots: ['/project'], trusted: true, hostVersion: modern })
    expect(plan.definitions).toEqual([])
  })

  it('offers nothing in an untrusted workspace, whatever the configuration says', () => {
    const plan = planEditorDefinitions({ servers: [spec()], roots: ['/project'], trusted: false, hostVersion: modern })
    expect(plan.definitions).toEqual([])
    expect(plan.problems).toEqual([])
  })

  it('offers each opted-in server in each project, with the project as the working directory', () => {
    const plan = planEditorDefinitions({ servers: [spec()], roots: ['/project'], trusted: true, hostVersion: modern })
    expect(plan.definitions).toEqual([{
      id: 'ask-ruby',
      label: 'ask-ruby',
      command: 'ask-ruby-harness-mcp',
      args: ['--stdio'],
      env: { MODE: 'read' },
      cwd: '/project',
      version: expect.stringMatching(/^[0-9a-f]{16}$/),
    }])
  })

  it('does not offer a server whose project cannot be set as its working directory, and says why', () => {
    const plan = planEditorDefinitions({ servers: [spec()], roots: ['/project'], trusted: true, hostVersion: '1.100.0' })
    expect(plan.definitions).toEqual([])
    expect(plan.problems).toEqual([expect.stringContaining('VS Code 1.100.0 cannot set the working directory')])
    expect(plan.problems[0]).toContain('ask-ruby')
  })

  it('gives every project of a multi-root workspace its own definition, each with its own working directory', () => {
    const plan = planEditorDefinitions({ servers: [spec()], roots: ['/work/alpha', '/work/beta'], trusted: true, hostVersion: modern })
    expect(plan.definitions.map(d => d.cwd)).toEqual(['/work/alpha', '/work/beta'])
    expect(plan.definitions.map(d => d.label)).toEqual(['ask-ruby (alpha)', 'ask-ruby (beta)'])
    // Ids must differ across projects, or the editor would merge two processes into one.
    expect(new Set(plan.definitions.map(d => d.id)).size).toBe(2)
  })

  it('changes the version when the command or arguments change, so the editor refreshes its tools', () => {
    const a = planEditorDefinitions({ servers: [spec()], roots: ['/p'], trusted: true, hostVersion: modern }).definitions[0].version
    const b = planEditorDefinitions({ servers: [spec({ args: ['--other'] })], roots: ['/p'], trusted: true, hostVersion: modern }).definitions[0].version
    const c = planEditorDefinitions({ servers: [spec({ env: { MODE: 'write' } })], roots: ['/p'], trusted: true, hostVersion: modern }).definitions[0].version
    expect(a).not.toBe(b)
    expect(a).toBe(c) // the environment is not part of the version, so a value cannot leak through it
  })

  it('does not copy the environment into the version or the label', () => {
    const plan = planEditorDefinitions({ servers: [spec({ env: { TOKEN_VALUE: 'secret-value' } })], roots: ['/p'], trusted: true, hostVersion: modern })
    expect(JSON.stringify(plan.definitions[0].version)).not.toContain('secret')
    expect(plan.definitions[0].label).not.toContain('secret')
  })
})

describe('the editor path does not reach into RailsForge\'s own agent code', () => {
  it('keeps the editor module free of vscode, so the policy stays unit-testable', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'mcp', 'external', 'EditorDefinitions.ts'), 'utf8')
    expect(source).not.toMatch(/from ['"]vscode['"]/)
  })
})
