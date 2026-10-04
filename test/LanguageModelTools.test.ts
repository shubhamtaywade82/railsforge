import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { RAILSFORGE_TOOLS } from '../src/mcp/tools/definitions'
import { buildLanguageModelToolManifest, lmToolName } from '../src/mcp/tools/lmManifest'
import { LmApiLike, registerRailsLanguageModelTools, truncateForModel } from '../src/ai/RailsLanguageModelTools'

const pkgPath = path.resolve(__dirname, '..', 'package.json')

describe('languageModelTools manifest', () => {
  const expected = buildLanguageModelToolManifest(RAILSFORGE_TOOLS)

  it('package.json stays in sync with the tool definitions (set SYNC_LM_TOOLS=1 to regenerate)', () => {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { contributes: Record<string, unknown> }
    if (process.env.SYNC_LM_TOOLS === '1') {
      pkg.contributes.languageModelTools = expected
      fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
      return
    }
    expect(pkg.contributes.languageModelTools, 'run: SYNC_LM_TOOLS=1 pnpm exec vitest run test/LanguageModelTools.test.ts').toEqual(expected)
  })

  it('every entry has a valid name, description and object schema', () => {
    for (const entry of expected) {
      expect(entry.name).toMatch(/^railsforge_[a-z_]+$/)
      expect(entry.modelDescription.length).toBeGreaterThan(20)
      expect(entry.inputSchema).toMatchObject({ type: 'object' })
    }
    expect(new Set(expected.map(e => e.name)).size).toBe(expected.length)
  })

  it('marks required inputs only for non-optional fields', () => {
    const method = expected.find(e => e.toolReferenceName === 'get_method_notes')!
    expect(method.inputSchema.required).toEqual(['method_name', 'class_name'])
    const schema = expected.find(e => e.toolReferenceName === 'get_schema')!
    expect(schema.inputSchema.required ?? []).toEqual([])
  })
})

describe('registerRailsLanguageModelTools', () => {
  const makeRuntime = (root: string | undefined) => {
    const registered = new Map<string, Parameters<LmApiLike['registerTool']>[1]>()
    const lm: LmApiLike = {
      registerTool: (name, tool) => { registered.set(name, tool); return { dispose: vi.fn() } },
    }
    return { registered, runtime: { lm, getRoot: () => root, toResult: (t: string) => ({ text: t }) } }
  }

  it('registers every tool under its railsforge_ name', () => {
    const { registered, runtime } = makeRuntime('/x')
    registerRailsLanguageModelTools(runtime)
    expect([...registered.keys()].sort()).toEqual(RAILSFORGE_TOOLS.map(lmToolName).sort())
  })

  it('invokes the shared handler against the active project', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-lm-'))
    fs.mkdirSync(path.join(root, 'db'))
    fs.writeFileSync(path.join(root, 'db', 'schema.rb'), 'ActiveRecord::Schema.define do\n  create_table "users" do |t|\n    t.string "email"\n  end\nend\n')
    const { registered, runtime } = makeRuntime(root)
    registerRailsLanguageModelTools(runtime)
    const result = await registered.get('railsforge_get_schema')!.invoke({ input: {} }, undefined) as { text: string }
    expect(result.text).toContain('"users"')
    expect(result.text).toContain('email')
  })

  it('answers politely with no workspace, and reports handler errors as text', async () => {
    const none = makeRuntime(undefined)
    registerRailsLanguageModelTools(none.runtime)
    expect(((await none.registered.get('railsforge_get_schema')!.invoke({ input: {} }, undefined)) as { text: string }).text).toContain('No Ruby/Rails workspace')

    const boom = [{ ...RAILSFORGE_TOOLS[0], handler: async () => { throw new Error('kaboom') } }]
    const { registered, runtime } = makeRuntime('/x')
    registerRailsLanguageModelTools(runtime, boom)
    const out = (await registered.get(lmToolName(boom[0]))!.invoke({ input: {} }, undefined)) as { text: string }
    expect(out.text).toBe(`Error running ${boom[0].name}: kaboom`)
  })

  it('truncates very large output', () => {
    expect(truncateForModel('a'.repeat(70_000))).toContain('[truncated 10000 characters]')
    expect(truncateForModel('short')).toBe('short')
  })
})
