import { describe, it, expect } from 'vitest'
import { RefactorAdvisor, AdvisorDeps } from '../src/refactor/advisor/RefactorAdvisor'
import { ADVISOR_SYSTEM_PROMPT } from '../src/refactor/advisor/PromptBuilder'
import { ADVISOR_LIMITS, RefactorSuggestion, RefactorTarget, SyntaxVerdict } from '../src/refactor/advisor/types'

const ORDER_SRC = [
  'class Order < ApplicationRecord', // 1
  '  def total', // 2
  '    items.sum(&:price) * 1.2', // 3
  '  end', // 4
  '', // 5
  '  def tax', // 6
  '    total * 0.2', // 7
  '  end', // 8
  'end', // 9
  '',
].join('\n')

const TOTAL_TARGET: RefactorTarget = {
  kind: 'method',
  name: 'total',
  className: 'Order',
  startLine: 2,
  endLine: 4,
  text: '  def total\n    items.sum(&:price) * 1.2\n  end',
}

const SUGGESTION: RefactorSuggestion = {
  id: 's1',
  title: 'Extract TaxCalculator',
  pattern: 'Service Object',
  impact: 'low',
  rationale: 'Order#total embeds the tax rate, so pricing rules live in the model.',
  files: ['app/models/order.rb', 'app/services/tax_calculator.rb'],
  steps: ['Create TaxCalculator', 'Delegate Order#total to it'],
}

const SUGGESTIONS_JSON = JSON.stringify({
  suggestions: [{
    title: 'Extract TaxCalculator',
    pattern: 'Service Object',
    principle: 'SRP',
    impact: 'low',
    rationale: 'Order#total embeds the tax rate, so pricing rules live in the model.',
    files: ['app/models/order.rb', 'app/services/tax_calculator.rb', 'config/routes.rb'],
    steps: ['Create TaxCalculator'],
  }],
})

/** A correct plan: edits Order#total and creates TaxCalculator. */
const GOOD_DIFF = [
  '--- a/app/models/order.rb',
  '+++ b/app/models/order.rb',
  '@@ -1,5 +1,5 @@',
  ' class Order < ApplicationRecord',
  '   def total',
  '-    items.sum(&:price) * 1.2',
  '+    TaxCalculator.new.gross(items.sum(&:price))',
  '   end',
  ' ',
  '   def tax',
  '--- /dev/null',
  '+++ b/app/services/tax_calculator.rb',
  '@@ -0,0 +1,5 @@',
  '+class TaxCalculator',
  '+  def gross(amount)',
  '+    amount * 1.2',
  '+  end',
  '+end',
].join('\n')

interface Reply { success: boolean; response: string }

class FakeModel {
  readonly prompts: string[] = []
  readonly contexts: Array<{ isolated: true; isolatedSystemPrompt: string }> = []
  private readonly replies: Reply[]

  constructor(replies: Array<string | Reply>) {
    this.replies = replies.map(r => typeof r === 'string' ? { success: true, response: r } : r)
  }

  async run(prompt: string, context: { isolated: true; isolatedSystemPrompt: string }): Promise<Reply> {
    this.prompts.push(prompt)
    this.contexts.push(context)
    const next = this.replies.shift()
    if (!next) {throw new Error('FakeModel: no scripted reply left')}
    return next
  }
}

function build(options: {
  replies: Array<string | Reply>
  files?: Record<string, string>
  syntax?: (code: string) => SyntaxVerdict
}) {
  const model = new FakeModel(options.replies)
  const files = new Map<string, string>(Object.entries(options.files ?? { 'app/models/order.rb': ORDER_SRC }))
  const deps: AdvisorDeps = {
    agent: model,
    index: {
      findDefiningFiles: () => [],
      incomingDependencies: () => [],
    },
    files: { read: async path => files.get(path) },
    catalog: {
      listCatalog: () => [{ id: 'service', name: 'Service Object' }, { id: 'query', name: 'Query Object' }],
      listProjectInstances: () => [],
    },
    checkSyntax: async code => (options.syntax ?? (() => ({ status: 'ok' as const })))(code),
  }
  return { advisor: new RefactorAdvisor(deps), model, files }
}

const syntaxRejectsMarker = (code: string): SyntaxVerdict =>
  code.includes('BROKEN')
    ? { status: 'error', message: 'syntax error, unexpected end-of-input' }
    : { status: 'ok' }

describe('RefactorAdvisor.suggest', () => {
  it('returns suggestions, drops paths outside the Rails roots, and uses the isolated system prompt', async () => {
    const { advisor, model } = build({ replies: [SUGGESTIONS_JSON] })
    const result = await advisor.suggest({ relativePath: 'app/models/order.rb', content: ORDER_SRC, target: TOTAL_TARGET })

    expect(result).toEqual({
      ok: true,
      value: [{
        id: 's1',
        title: 'Extract TaxCalculator',
        pattern: 'Service Object',
        principle: 'SRP',
        impact: 'low',
        rationale: 'Order#total embeds the tax rate, so pricing rules live in the model.',
        files: ['app/models/order.rb', 'app/services/tax_calculator.rb'],
        steps: ['Create TaxCalculator'],
      }],
    })
    expect(model.contexts[0]).toEqual({ isolated: true, isolatedSystemPrompt: ADVISOR_SYSTEM_PROMPT })
    expect(model.prompts[0]).toContain('TARGET (method Order#total')
    expect(model.prompts[0]).toContain('Service Object')
  })

  it('returns an empty list when the target is already well designed', async () => {
    const { advisor } = build({ replies: ['{"suggestions": []}'] })
    expect(await advisor.suggest({ relativePath: 'app/models/order.rb', content: ORDER_SRC, target: TOTAL_TARGET }))
      .toEqual({ ok: true, value: [] })
  })

  it('sends one corrective retry with the reason when the first answer is not JSON', async () => {
    const { advisor, model } = build({ replies: ['Sure! Here are some ideas...', SUGGESTIONS_JSON] })
    const result = await advisor.suggest({ relativePath: 'app/models/order.rb', content: ORDER_SRC, target: TOTAL_TARGET })

    expect(result.ok).toBe(true)
    expect(model.prompts).toHaveLength(2)
    expect(model.prompts[1]).toContain('Your previous answer was rejected: The answer contained no JSON object.')
  })

  it('gives up after the repair round and reports the last reason', async () => {
    const { advisor, model } = build({ replies: ['nope', 'still nope'] })
    const result = await advisor.suggest({ relativePath: 'app/models/order.rb', content: ORDER_SRC, target: TOTAL_TARGET })

    expect(result).toEqual({ ok: false, reason: 'invalid-response', message: 'The answer contained no JSON object.' })
    expect(model.prompts).toHaveLength(ADVISOR_LIMITS.maxRepairRounds + 1)
  })

  it('does not retry a provider failure, and passes the provider message through', async () => {
    const { advisor, model } = build({ replies: [{ success: false, response: 'No Ollama at localhost:11434' }] })
    const result = await advisor.suggest({ relativePath: 'app/models/order.rb', content: ORDER_SRC, target: TOTAL_TARGET })

    expect(result).toEqual({ ok: false, reason: 'model-unavailable', message: 'No Ollama at localhost:11434' })
    expect(model.prompts).toHaveLength(1)
  })

  it('refuses a primary file outside the allowed roots without calling the model', async () => {
    const { advisor, model } = build({ replies: [] })
    const result = await advisor.suggest({ relativePath: 'config/application.rb', content: ORDER_SRC, target: TOTAL_TARGET })

    expect(result).toMatchObject({ ok: false, reason: 'unsafe-path' })
    expect(model.prompts).toHaveLength(0)
  })

  it('rejects an answer whose every file path is unsafe, and asks again', async () => {
    const unsafeOnly = JSON.stringify({
      suggestions: [{ title: 'Edit routes', pattern: 'Facade', impact: 'low', rationale: 'Routes hold business logic.', files: ['config/routes.rb'] }],
    })
    const { advisor, model } = build({ replies: [unsafeOnly, SUGGESTIONS_JSON] })
    const result = await advisor.suggest({ relativePath: 'app/models/order.rb', content: ORDER_SRC, target: TOTAL_TARGET })

    expect(result.ok).toBe(true)
    expect(model.prompts[1]).toContain('None of the suggestions named a usable file')
  })

  it('tells the model the primary file is too large to include whole, and still sends the target', async () => {
    const big = `class Big\n${'  # filler line for the size test\n'.repeat(400)}  def total\n    1\n  end\nend\n`
    const { advisor, model } = build({ replies: ['{"suggestions": []}'], files: { 'app/models/big.rb': big } })
    await advisor.suggest({ relativePath: 'app/models/big.rb', content: big, target: TOTAL_TARGET })

    expect(model.prompts[0]).toContain('too large to include whole')
    expect(model.prompts[0]).toContain('TARGET (method Order#total')
  })
})

describe('RefactorAdvisor.plan', () => {
  it('returns the exact changes: an in-place edit and a new file, with nothing written', async () => {
    const { advisor, model, files } = build({ replies: [GOOD_DIFF] })
    const before = new Map(files)
    const result = await advisor.plan(SUGGESTION)

    expect(result.ok).toBe(true)
    if (!result.ok) {return}
    expect(result.value.syntaxUnverified).toBe(false)
    expect(result.value.changes).toEqual([
      {
        path: 'app/models/order.rb',
        kind: 'modify',
        before: ORDER_SRC,
        after: ORDER_SRC.replace(
          '    items.sum(&:price) * 1.2',
          '    TaxCalculator.new.gross(items.sum(&:price))',
        ),
      },
      {
        path: 'app/services/tax_calculator.rb',
        kind: 'create',
        before: undefined,
        after: 'class TaxCalculator\n  def gross(amount)\n    amount * 1.2\n  end\nend\n',
      },
    ])
    expect(model.prompts[0]).toContain('=== app/services/tax_calculator.rb ===\n(does not exist yet)')
    // plan() only proposes: the in-memory store is untouched.
    expect(files).toEqual(before)
  })

  it('sends one corrective retry when the context lines do not match the current file', async () => {
    const stale = GOOD_DIFF.replace(' class Order < ApplicationRecord', ' class Orderz < ApplicationRecord')
    const { advisor, model } = build({ replies: [stale, GOOD_DIFF] })
    const result = await advisor.plan(SUGGESTION)

    expect(result.ok).toBe(true)
    expect(model.prompts[1]).toContain('no longer matches the current file')
  })

  it('rejects a hunk that touches a file the suggestion did not list', async () => {
    const outOfScope = GOOD_DIFF.replace(/app\/models\/order\.rb/g, 'app/models/user.rb')
    const { advisor } = build({ replies: [outOfScope, outOfScope] })
    const result = await advisor.plan(SUGGESTION)

    expect(result).toMatchObject({ ok: false, reason: 'file-not-allowed' })
  })

  it('rejects a path-traversal header in the diff', async () => {
    const traversal = GOOD_DIFF.replace('+++ b/app/services/tax_calculator.rb', '+++ b/../../etc/cron.rb')
    const { advisor } = build({ replies: [traversal, traversal] })
    expect(await advisor.plan(SUGGESTION)).toMatchObject({ ok: false, reason: 'unsafe-path' })
  })

  it('rejects a deletion (+++ /dev/null): the advisor never deletes files', async () => {
    const deletion = ['--- a/app/models/order.rb', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-class Order < ApplicationRecord'].join('\n')
    const { advisor } = build({ replies: [deletion, deletion] })
    expect(await advisor.plan(SUGGESTION)).toMatchObject({ ok: false, reason: 'unsafe-path' })
  })

  it('rejects an answer that is not a diff at all', async () => {
    const { advisor } = build({ replies: ['Here is the refactored class: class Order; end', 'still prose'] })
    expect(await advisor.plan(SUGGESTION)).toMatchObject({ ok: false, reason: 'invalid-response' })
  })

  it('rejects an edit (old lines) aimed at a file that does not exist yet', async () => {
    const editMissing = [
      '--- a/app/services/tax_calculator.rb',
      '+++ b/app/services/tax_calculator.rb',
      '@@ -1,2 +1,2 @@',
      ' class TaxCalculator',
      '-  def gross(a); a; end',
      '+  def gross(amount) = amount',
    ].join('\n')
    const { advisor } = build({ replies: [editMissing, editMissing] })
    expect(await advisor.plan(SUGGESTION)).toMatchObject({ ok: false, reason: 'file-missing' })
  })

  it('rejects a /dev/null create aimed at a file that already exists', async () => {
    const { advisor } = build({
      replies: [GOOD_DIFF, GOOD_DIFF],
      files: { 'app/models/order.rb': ORDER_SRC, 'app/services/tax_calculator.rb': 'class TaxCalculator; end\n' },
    })
    expect(await advisor.plan(SUGGESTION)).toMatchObject({ ok: false, reason: 'file-exists' })
  })

  it('rejects a change that would not parse as Ruby, and reports the file', async () => {
    const broken = GOOD_DIFF.replace('    TaxCalculator.new.gross(items.sum(&:price))', '    BROKEN(items.sum(&:price)')
    const { advisor } = build({ replies: [broken, broken], syntax: syntaxRejectsMarker })
    const result = await advisor.plan(SUGGESTION)

    expect(result).toMatchObject({ ok: false, reason: 'syntax-error' })
    expect(result.ok ? '' : result.message).toContain('app/models/order.rb would not parse as Ruby')
  })

  it('repairs a syntax error on the second attempt', async () => {
    const broken = GOOD_DIFF.replace('    TaxCalculator.new.gross(items.sum(&:price))', '    BROKEN(items.sum(&:price)')
    const { advisor, model } = build({ replies: [broken, GOOD_DIFF], syntax: syntaxRejectsMarker })
    const result = await advisor.plan(SUGGESTION)

    expect(result.ok).toBe(true)
    expect(model.prompts[1]).toContain('would not parse as Ruby')
  })

  it('still applies when no Ruby interpreter is available, and flags the change as unverified', async () => {
    const { advisor } = build({ replies: [GOOD_DIFF], syntax: () => ({ status: 'unavailable' }) })
    const result = await advisor.plan(SUGGESTION)

    expect(result.ok).toBe(true)
    expect(result.ok && result.value.syntaxUnverified).toBe(true)
  })

  it('rejects a diff that changes nothing', async () => {
    const noop = [
      '--- a/app/models/order.rb',
      '+++ b/app/models/order.rb',
      '@@ -1,5 +1,5 @@',
      ' class Order < ApplicationRecord',
      '   def total',
      '-    items.sum(&:price) * 1.2',
      '+    items.sum(&:price) * 1.2',
      '   end',
      ' ',
    ].join('\n')
    const { advisor } = build({ replies: [noop, noop] })
    expect(await advisor.plan({ ...SUGGESTION, files: ['app/models/order.rb'] })).toMatchObject({ ok: false, reason: 'no-change' })
  })

  it('refuses to plan when the files total more than the apply limit, without calling the model', async () => {
    const huge = `class Order\n${'  x = 1\n'.repeat(3000)}end\n`
    const { advisor, model } = build({ replies: [], files: { 'app/models/order.rb': huge } })
    const result = await advisor.plan({ ...SUGGESTION, files: ['app/models/order.rb'] })

    expect(result).toMatchObject({ ok: false, reason: 'too-large' })
    expect(model.prompts).toHaveLength(0)
  })

  it('refuses a suggestion whose stored paths are unsafe, without reading or calling the model', async () => {
    const { advisor, model } = build({ replies: [] })
    const result = await advisor.plan({ ...SUGGESTION, files: ['db/schema.rb'] })

    expect(result).toMatchObject({ ok: false, reason: 'unsafe-path' })
    expect(model.prompts).toHaveLength(0)
  })
})
