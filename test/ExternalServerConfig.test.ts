import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { parseExternalServers } from '../src/mcp/external/ExternalServerConfig'

const valid = {
  id: 'rails-ai-context',
  command: 'bundle',
  args: ['exec', 'rails-ai-context', 'serve'],
  env: { RAILS_ENV: 'development' },
  allowTools: ['get_schema'],
}

describe('parseExternalServers', () => {
  it('treats a missing or null setting as no servers, with no problems', () => {
    expect(parseExternalServers(undefined)).toEqual({ servers: [], problems: [] })
    expect(parseExternalServers(null)).toEqual({ servers: [], problems: [] })
    expect(parseExternalServers([])).toEqual({ servers: [], problems: [] })
  })

  it('applies defaults: enabled, stdio, no args or env, and nothing allowed', () => {
    const { servers, problems } = parseExternalServers([{ id: 'ruby-gems', command: 'gems-mcp' }])
    expect(problems).toEqual([])
    expect(servers).toEqual([{
      id: 'ruby-gems',
      enabled: true,
      transport: 'stdio',
      command: 'gems-mcp',
      args: [],
      env: {},
      allowTools: [],
    }])
  })

  it('accepts a complete valid entry and de-duplicates allowTools', () => {
    const { servers, problems } = parseExternalServers([{ ...valid, allowTools: ['get_schema', 'get_schema', 'list_routes'] }])
    expect(problems).toEqual([])
    expect(servers[0].args).toEqual(['exec', 'rails-ai-context', 'serve'])
    expect(servers[0].env).toEqual({ RAILS_ENV: 'development' })
    expect(servers[0].allowTools).toEqual(['get_schema', 'list_routes'])
  })

  it('rejects a setting that is not an array', () => {
    const { servers, problems } = parseExternalServers({ id: 'x', command: 'y' })
    expect(servers).toEqual([])
    expect(problems).toEqual([{ index: -1, message: expect.stringContaining('must be an array') }])
  })

  it.each([
    ['an uppercase id', { id: 'Rails' }],
    ['an id starting with a digit', { id: '1rails' }],
    ['an id with an underscore', { id: 'rails_ai' }],
    ['an id that is too long', { id: 'a'.repeat(33) }],
    ['a missing id', { id: undefined }],
  ])('rejects %s', (_label, override) => {
    const { servers, problems } = parseExternalServers([{ ...valid, ...override }])
    expect(servers).toEqual([])
    expect(problems[0].message).toContain('id must be')
  })

  it('rejects HTTP with a clear reason, because only stdio is supported', () => {
    const { servers, problems } = parseExternalServers([{ ...valid, transport: 'http', url: 'https://mcp.sentry.dev/mcp' }])
    expect(servers).toEqual([])
    expect(problems[0].message).toContain('HTTP servers are not supported yet')
  })

  it('rejects an unknown key, so a typo in allowTools cannot silently expose nothing', () => {
    const { servers, problems } = parseExternalServers([{ ...valid, allowtools: ['get_schema'] }])
    expect(servers).toEqual([])
    expect(problems[0].message).toContain('Unknown setting "allowtools"')
  })

  it.each([
    ['an empty command', { command: '' }],
    ['a command with surrounding spaces', { command: ' bundle ' }],
    ['a command with a line break', { command: 'bundle\nexec' }],
    ['a non-string command', { command: 3 }],
  ])('rejects %s', (_label, override) => {
    const { servers, problems } = parseExternalServers([{ ...valid, ...override }])
    expect(servers).toEqual([])
    expect(problems[0].message).toContain('command must be')
  })

  it('rejects args that are not strings, and args with a NUL byte', () => {
    expect(parseExternalServers([{ ...valid, args: ['ok', 1] }]).problems[0].message).toContain('args must be')
    expect(parseExternalServers([{ ...valid, args: ['bad\0arg'] }]).problems[0].message).toContain('args must be')
  })

  it('rejects env names that are not variable names, and non-string env values', () => {
    expect(parseExternalServers([{ ...valid, env: { 'BAD NAME': 'x' } } ]).problems[0].message).toContain('not a valid variable name')
    expect(parseExternalServers([{ ...valid, env: { TOKEN: 42 } }]).problems[0].message).toContain('must be a string')
  })

  it('rejects a non-boolean enabled flag', () => {
    expect(parseExternalServers([{ ...valid, enabled: 'yes' }]).problems[0].message).toContain('enabled must be')
  })

  it('keeps the valid entries and reports the invalid ones with their index', () => {
    const { servers, problems } = parseExternalServers([
      { id: 'good', command: 'good-tool' },
      { id: 'Bad', command: 'x' },
      { id: 'also-good', command: 'other' },
    ])
    expect(servers.map(s => s.id)).toEqual(['good', 'also-good'])
    expect(problems).toEqual([{ index: 1, id: 'Bad', message: expect.stringContaining('id must be') }])
  })

  it('ignores a later duplicate id and keeps the first entry', () => {
    const { servers, problems } = parseExternalServers([
      { id: 'dup', command: 'first' },
      { id: 'dup', command: 'second' },
    ])
    expect(servers).toHaveLength(1)
    expect(servers[0].command).toBe('first')
    expect(problems).toEqual([{ index: 1, id: 'dup', message: expect.stringContaining('Duplicate server id') }])
  })

  it('never throws on arbitrary input', () => {
    for (const hostile of [42, 'text', [null], [[]], [{ id: { toString: () => 'x' } }], [Object.create(null)]]) {
      expect(() => parseExternalServers(hostile)).not.toThrow()
    }
  })
})

describe('railsForge.mcp.servers manifest entry', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  const setting = manifest.contributes.configuration.properties['railsForge.mcp.servers']

  it('is application-scoped, so a repository settings file cannot define a server that starts a process', () => {
    expect(setting.scope).toBe('application')
  })

  it('declares only the stdio transport and rejects unknown keys in its schema', () => {
    expect(setting.items.properties.transport.enum).toEqual(['stdio'])
    expect(setting.items.additionalProperties).toBe(false)
  })
})
