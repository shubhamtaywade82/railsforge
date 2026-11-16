import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { exposeTools, externalLoopTool, checkArguments, MAX_EXTERNAL_TOOLS_PER_SERVER, RemoteToolDescriptor } from '../src/mcp/external/ExternalTools'
import { AUDIT_RELATIVE_PATH } from '../src/mcp/audit/McpAuditRecorder'

const listed: RemoteToolDescriptor[] = [
  { name: 'get_schema', description: 'Returns the schema. More detail follows.', inputSchema: { type: 'object', properties: { model: { type: 'string' }, limit: { type: 'integer' } }, required: ['model'] } },
  { name: 'write_file', description: 'Writes a file.', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'no_schema', inputSchema: { type: 'string' } as never },
]

describe('exposeTools', () => {
  it('default deny: a tool the server lists is not offered unless the user allowed it', () => {
    const { tools } = exposeTools('rails', listed, [])
    expect(tools).toEqual([])
  })

  it('offers only the allowed tools, namespaced by server id', () => {
    const { tools, problems } = exposeTools('rails', listed, ['get_schema'])
    expect(problems).toEqual([])
    expect(tools.map(t => t.exposedName)).toEqual(['rails__get_schema'])
    expect(tools[0].remoteName).toBe('get_schema')
    expect(tools[0].description).toBe('Returns the schema. More detail follows.')
  })

  it('reports an allowed name the server does not provide, and does not offer it', () => {
    const { tools, problems } = exposeTools('rails', listed, ['get_schema', 'drop_table'])
    expect(tools.map(t => t.remoteName)).toEqual(['get_schema'])
    expect(problems).toEqual([expect.stringContaining('"drop_table", which rails does not provide')])
  })

  it('does not offer a tool whose input schema is not an object schema', () => {
    const { tools, problems } = exposeTools('rails', listed, ['no_schema'])
    expect(tools).toEqual([])
    expect(problems).toEqual([expect.stringContaining('its input schema is not supported')])
  })

  it('does not offer a tool that uses a schema keyword the validator cannot enforce, and does not weaken it', () => {
    const withRef: RemoteToolDescriptor[] = [{ name: 'lookup', inputSchema: { type: 'object', properties: { id: { $ref: '#/x' } } } }]
    const { tools, problems } = exposeTools('rails', withRef, ['lookup'])
    expect(tools).toEqual([])
    expect(problems[0]).toContain('unsupported keyword "$ref"')
  })

  it('does not offer a tool whose exposed name the agent cannot use', () => {
    const odd: RemoteToolDescriptor[] = [{ name: 'run.shell', inputSchema: { type: 'object' } }]
    const { tools, problems } = exposeTools('rails', odd, ['run.shell'])
    expect(tools).toEqual([])
    expect(problems[0]).toContain('is not valid for the agent')
  })

  it('caps the number offered per server and says so', () => {
    const many: RemoteToolDescriptor[] = Array.from({ length: MAX_EXTERNAL_TOOLS_PER_SERVER + 5 }, (_, i) => ({ name: `t${i}`, inputSchema: { type: 'object' } }))
    const { tools, problems } = exposeTools('bulk', many, many.map(t => t.name))
    expect(tools).toHaveLength(MAX_EXTERNAL_TOOLS_PER_SERVER)
    expect(problems).toEqual([expect.stringContaining('More than')])
  })

  it('uses a fallback description when the server gives none', () => {
    const { tools } = exposeTools('rails', [{ name: 'quiet', inputSchema: { type: 'object' } }], ['quiet'])
    expect(tools[0].description).toBe('Tool "quiet" provided by rails.')
  })
})

describe('checkArguments', () => {
  const schema = { type: 'object', properties: { model: { type: 'string' }, limit: { type: 'integer' }, tags: { type: ['string', 'null'] } }, required: ['model'] }

  it('accepts arguments that match the declared shape and keeps them unchanged', () => {
    const args = { model: 'Order', limit: 5, tags: null }
    expect(checkArguments(schema, args)).toEqual({ ok: true, args })
  })

  it('names every missing required argument', () => {
    expect(checkArguments({ type: 'object', required: ['a', 'b'] }, {})).toEqual({ ok: false, message: 'a: is required; b: is required' })
  })

  it('rejects a value of the wrong JSON type', () => {
    expect(checkArguments(schema, { model: 'Order', limit: 2.5 })).toEqual({ ok: false, message: 'limit: expected integer' })
    expect(checkArguments(schema, { model: 7 })).toEqual({ ok: false, message: 'model: expected string' })
  })

  it('rejects arguments that are not an object', () => {
    expect(checkArguments(schema, [] as never).ok).toBe(false)
    expect(checkArguments(schema, null as never).ok).toBe(false)
  })

  it('refuses to check against a schema it cannot enforce, rather than passing the arguments', () => {
    const result = checkArguments({ type: 'object', properties: { x: { type: 'date' } } }, { x: 'today' })
    expect(result.ok).toBe(false)
    if (!result.ok) {expect(result.message).toContain('input schema is not supported')}
  })
})

describe('externalLoopTool', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-ext-tool-'))
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const exposed = exposeTools('rails', listed, ['get_schema']).tools[0]

  it('shows the server schema to the model and checks arguments against it', () => {
    const tool = externalLoopTool(exposed, root, { callRemote: async () => 'ok', isTrusted: () => true })
    expect(tool.name).toBe('rails__get_schema')
    expect(tool.jsonSchema).toBe(exposed.jsonSchema)
    expect(tool.checkArgs?.({ limit: 1 })).toEqual({ ok: false, message: 'model: is required' })
  })

  it('runs the remote tool when the workspace is trusted and returns its text', async () => {
    const callRemote = vi.fn(async () => 'the schema')
    const tool = externalLoopTool(exposed, root, { callRemote, isTrusted: () => true })
    await expect(tool.run({ model: 'Order' })).resolves.toBe('the schema')
    expect(callRemote).toHaveBeenCalledWith(exposed, root, { model: 'Order' }, undefined)
  })

  it('refuses without starting the remote tool in an untrusted workspace, and says why', async () => {
    const callRemote = vi.fn(async () => 'should not run')
    const tool = externalLoopTool(exposed, root, { callRemote, isTrusted: () => false })
    await expect(tool.run({ model: 'Order' })).rejects.toMatchObject({
      code: 'WORKSPACE_UNTRUSTED',
      message: expect.stringContaining('disabled in Restricted Mode'),
    })
    expect(callRemote).not.toHaveBeenCalled()
  })

  it('throws when the remote tool fails, so the loop reports a failed step', async () => {
    const tool = externalLoopTool(exposed, root, { callRemote: async () => { throw new Error('upstream down') }, isTrusted: () => true })
    await expect(tool.run({ model: 'Order' })).rejects.toThrow('upstream down')
  })

  it('audits each call with argument names only, never the values', async () => {
    const tool = externalLoopTool(exposed, root, { callRemote: async () => 'ok', isTrusted: () => true })
    await tool.run({ model: 'SecretOrderModelValue' })
    const lines = fs.readFileSync(path.join(root, AUDIT_RELATIVE_PATH), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(lines.map(l => l.phase)).toEqual(['started', 'finished'])
    expect(lines[0]).toMatchObject({ tool: 'rails__get_schema', risk: 'R2', source: 'host', argumentNames: ['model'] })
    expect(fs.readFileSync(path.join(root, AUDIT_RELATIVE_PATH), 'utf8')).not.toContain('SecretOrderModelValue')
  })
})
