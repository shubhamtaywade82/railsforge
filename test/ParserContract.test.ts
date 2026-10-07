/**
 * Contract: the TypeScript source extractors (regex over Ruby, src/semantic/facts.ts) must agree with Ruby's own
 * parser (Ripper, via test/contract/ruby_extract.rb) on the fixtures in test/contract/fixtures. Where regexes
 * cannot match a real parser, the gap is recorded in KNOWN_DIVERGENCES and pinned — fixing it later fails the
 * test and forces the ledger entry to be removed, so the "extracted" confidence class stays honest.
 */
import * as fs from 'fs'
import * as path from 'path'
import { spawnSync } from 'child_process'
import { describe, expect, it } from 'vitest'
import { publicMethods, sourceFileFacts } from '../src/semantic/facts'
import { FactBatch } from '../src/semantic/types'

const fixtures = path.join(__dirname, 'contract', 'fixtures')
const script = path.join(__dirname, 'contract', 'ruby_extract.rb')
const hasRuby = spawnSync('ruby', ['-v']).status === 0
const REQUIRE_RUBY = process.env.RAILSFORGE_REQUIRE_RUBY === '1'

interface Truth {
  file: string
  class: string | null
  superclass?: string | null
  associations?: Array<{ macro: string; name: string; class_name: string | null; through: string | null; dependent: string | null; optional: boolean | null; polymorphic: boolean }>
  validations?: string[]
  callbacks?: string[]
  scopes?: string[]
  filters?: string[]
  public_methods?: string[]
}

const FILES = [
  'app/models/order.rb',
  'app/models/shipment.rb',
  'app/models/divergences.rb',
  'app/controllers/orders_controller.rb',
  'app/controllers/admin/users_controller.rb',
]

/** Facts documented as impossible for a line-oriented regex; value = what TS reports that Ruby does not. */
const KNOWN_DIVERGENCES: Record<string, { extraValidations: string[] }> = {
  // Text inside a heredoc that looks like a macro call.
  'app/models/divergences.rb': { extraValidations: ['validates:fake_in_heredoc'] },
}

function ruby(): Map<string, Truth> {
  const res = spawnSync('ruby', [script, ...FILES], { cwd: fixtures, encoding: 'utf8' })
  if (res.status !== 0) {throw new Error(`ruby_extract.rb failed: ${res.stderr}`)}
  return new Map((JSON.parse(res.stdout) as Truth[]).map(t => [t.file, t]))
}

function typescript(file: string): Truth {
  const content = fs.readFileSync(path.join(fixtures, file), 'utf8')
  const batch: FactBatch = sourceFileFacts({ path: file, content })
  const main = batch.entities.find(e => e.kind === 'model' || e.kind === 'controller')
  if (!main) {return { file, class: null }}
  const attrs = (k: string): string[] => (Array.isArray(main.attrs?.[k]) ? (main.attrs![k] as string[]) : [])
  return {
    file,
    class: main.name,
    superclass: (main.attrs?.superclass as string | undefined) ?? null,
    associations: batch.edges
      .filter(e => ['belongs_to', 'has_many', 'has_one', 'has_and_belongs_to_many'].includes(e.kind))
      .map(e => ({
        macro: e.kind,
        name: String(e.attrs?.name),
        // Only an explicit class_name is observable on the edge; the target equals it in that case.
        class_name: e.attrs?.name && e.to !== `model:${'?'}` ? e.to.replace(/^model:/, '') : null,
        through: (e.attrs?.through as string | undefined) ?? null,
        dependent: (e.attrs?.dependent as string | undefined) ?? null,
        optional: (e.attrs?.optional as boolean | undefined) ?? null,
        polymorphic: Boolean(e.attrs?.polymorphic),
      })),
    validations: attrs('validations'),
    callbacks: attrs('callbacks'),
    scopes: attrs('scopes'),
    filters: attrs('filters'),
    public_methods: publicMethods(content).map(m => m.name),
  }
}

describe.skipIf(!hasRuby && !REQUIRE_RUBY)('TypeScript extractors vs Ruby (Ripper) ground truth', () => {
  it('has Ruby available when the CI job requires it', () => {
    expect(hasRuby).toBe(true)
  })

  const truth = hasRuby ? ruby() : new Map<string, Truth>()

  for (const file of FILES) {
    describe(file, () => {
      const t = (): Truth => truth.get(file)!
      const ts = (): Truth => typescript(file)
      const modelOrController = (): boolean => /models/.test(file) || /controller/.test(file)

      it('finds the same qualified class and superclass', () => {
        expect(ts().class).toBe(t().class)
        expect(ts().superclass ?? null).toBe(t().superclass ?? null)
        expect(modelOrController()).toBe(true)
      })

      if (file.includes('/models/')) {
        it('extracts the same associations (macro, name, through, dependent, optional, polymorphic, explicit class_name)', () => {
          const norm = (a: NonNullable<Truth['associations']>[number]): string =>
            JSON.stringify([a.macro, a.name, a.through, a.dependent, a.optional, a.polymorphic])
          expect(ts().associations!.map(norm)).toEqual(t().associations!.map(norm))
          for (const [i, a] of t().associations!.entries()) {
            if (a.class_name) {expect(ts().associations![i].class_name).toBe(a.class_name)}
          }
        })

        it('extracts the same validations, minus documented divergences', () => {
          const extra = KNOWN_DIVERGENCES[file]?.extraValidations ?? []
          expect(ts().validations!.filter(v => !extra.includes(v))).toEqual(t().validations)
          // The ledger must not rot: every recorded divergence is still a real divergence.
          for (const e of extra) {expect(ts().validations).toContain(e)}
          for (const e of extra) {expect(t().validations).not.toContain(e)}
        })

        it('extracts the same callbacks and scopes', () => {
          expect(ts().callbacks).toEqual(t().callbacks)
          expect(ts().scopes).toEqual(t().scopes)
        })
      }

      it('extracts the same public instance methods (visibility-aware)', () => {
        expect(ts().public_methods).toEqual(t().public_methods)
      })

      if (file.includes('/controllers/')) {
        it('extracts the same filters (every symbol of a multi-symbol call)', () => {
          expect(ts().filters).toEqual(t().filters)
        })
      }
    })
  }
})
