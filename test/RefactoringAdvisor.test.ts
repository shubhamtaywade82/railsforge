import { describe, it, expect } from 'vitest'
import { RubyAstParser } from '../src/indexer/RubyAstParser'
import { collectCandidates } from '../src/refactoring-intelligence/analyzers/CandidateCollector'
import { RefactoringAdvisor, AdvisorDeps } from '../src/refactoring-intelligence/core/RefactoringAdvisor'
import { ADVISOR_SYSTEM_PROMPT } from '../src/refactoring-intelligence/core/RefactoringPrompts'
import type { Candidate, Recommendation, RefactorTarget, SyntaxVerdict } from '../src/refactoring-intelligence/core/types'

const CONTROLLER = [
  'class OrdersController < ApplicationController',
  '  def create',
  '    @order = Order.new(order_params)',
  '',
  '    if @order.save',
  '      InventoryService.new.reserve(@order)',
  '      PaymentGateway.new.charge(@order)',
  '      OrderMailer.confirmation(@order).deliver_later',
  '',
  '      redirect_to @order',
  '    else',
  '      render :new',
  '    end',
  '  end',
  'end',
  '',
].join('\n')
const PATH = 'app/controllers/orders_controller.rb'

const SCOPE: RefactorTarget = {
  kind: 'method',
  name: 'create',
  className: 'OrdersController',
  startLine: 2,
  endLine: 14,
  text: CONTROLLER.split('\n').slice(1, 14).join('\n'),
}

function findings(): Candidate[] {
  return collectCandidates(new RubyAstParser(), { path: PATH, content: CONTROLLER })
}

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

function build(options: { replies: Array<string | Reply>; files?: Record<string, string>; syntax?: (code: string) => SyntaxVerdict }) {
  const model = new FakeModel(options.replies)
  const files = new Map<string, string>(Object.entries(options.files ?? { [PATH]: CONTROLLER }))
  const deps: AdvisorDeps = {
    agent: model,
    index: { findDefiningFiles: () => [], incomingDependencies: () => [] },
    files: { read: async path => files.get(path) },
    catalog: {
      listCatalog: () => [{ id: 'service-object', name: 'Service Object' }, { id: 'strategy', name: 'Strategy' }],
      listProjectInstances: () => [],
    },
    checkSyntax: async code => (options.syntax ?? (() => ({ status: 'ok' as const })))(code),
  }
  return { advisor: new RefactoringAdvisor(deps), model, files }
}

const decision = (overrides: Record<string, unknown> = {}) => ({
  candidateId: 'c1',
  decision: 'recommend',
  technique: 'service-object',
  design: 'Move the order workflow into CreateOrder; the controller keeps params and redirects.',
  benefit: 'The workflow can be tested without a request.',
  risk: 'Transactions and the order of side effects must be preserved.',
  alternatives: [{ name: 'Command object', whenBetter: 'the workflow is undone as a unit' }],
  affectedFiles: ['app/services/create_order.rb'],
  steps: ['Create CreateOrder', 'Call it from create'],
  verification: ['Run the request spec for create'],
  ...overrides,
})

const answer = (...decisions: Array<Record<string, unknown>>) => JSON.stringify({ decisions })

describe('RefactoringAdvisor.refine: the model decides only on measured findings', () => {
  it('makes no model call when no finding has a validated technique', async () => {
    const { advisor, model } = build({ replies: [] })
    const result = await advisor.refine({ path: PATH, content: CONTROLLER, scope: SCOPE, candidates: [] })
    expect(result).toEqual({ ok: true, value: { recommendations: [], skipped: [] } })
    expect(model.prompts).toHaveLength(0)
  })

  it('turns an allowed recommendation into the contract, with priority and confidence derived from the measurement', async () => {
    const { advisor, model } = build({
      // The model tries to raise the priority; the advisor must ignore it.
      replies: [answer(decision({ priority: 'critical', confidence: 'high' }))],
    })
    const result = await advisor.refine({ path: PATH, content: CONTROLLER, scope: SCOPE, candidates: findings() })

    expect(result.ok).toBe(true)
    if (!result.ok) {return}
    const [rec] = result.value.recommendations
    expect(rec).toMatchObject({
      id: 'r1',
      source: 'ai',
      candidateIds: ['c1'],
      path: PATH,
      title: 'Service Object: OrdersController#create',
      priority: 'high',
      confidence: 'medium',
      technique: { id: 'service-object', name: 'Service Object' },
    })
    expect(rec.affectedFiles).toEqual([PATH, 'app/services/create_order.rb'])
    expect(rec.evidence.length).toBeGreaterThan(0)
    expect(model.contexts[0]).toEqual({ isolated: true, isolatedSystemPrompt: ADVISOR_SYSTEM_PROMPT })
  })

  it('merges the model alternatives with the validated ones, keeping "Keep the current code" last', async () => {
    const { advisor } = build({ replies: [answer(decision())] })
    const result = await advisor.refine({ path: PATH, content: CONTROLLER, scope: SCOPE, candidates: findings() })
    const names = result.ok ? result.value.recommendations[0].alternatives.map(a => a.name) : []
    expect(names[0]).toBe('Command object')
    expect(names[names.length - 1]).toBe('Keep the current code')
    expect(names).toContain('Domain Event')
  })

  it('lets the model skip a finding, and returns the reason', async () => {
    const { advisor } = build({ replies: [answer(decision({ decision: 'skip', reason: 'one step only; a service would just rename the call' }))] })
    const result = await advisor.refine({ path: PATH, content: CONTROLLER, scope: SCOPE, candidates: findings() })
    expect(result).toEqual({
      ok: true,
      value: { recommendations: [], skipped: [{ candidateId: 'c1', reason: 'one step only; a service would just rename the call' }] },
    })
  })

  it('keeps the first decision when the model decides the same finding twice', async () => {
    const { advisor } = build({ replies: [answer({ candidateId: 'c1', decision: 'skip', reason: 'fine' }, { candidateId: 'c1', decision: 'recommend', technique: 'service-object' })] })
    const result = await advisor.refine({ path: PATH, content: CONTROLLER, scope: SCOPE, candidates: findings() })
    expect(result.ok && result.value.recommendations).toEqual([])
  })

  it('records a finding the model left out as undecided, and never recommends it', async () => {
    const content = CONTROLLER.replace(
      '  end\nend\n',
      '  end\n\n  def cancel\n    authorize! :cancel, @order\n    raise unless current_user.admin?\n    authorize! :refund, @order\n  end\nend\n',
    )
    const twoFindings = collectCandidates(new RubyAstParser(), { path: PATH, content })
    const workflow = twoFindings.find(c => c.kind === 'rails.controller-workflow')
    const authorization = twoFindings.find(c => c.kind === 'rails.inline-authorization')
    expect(workflow && authorization).toBeTruthy()

    const { advisor } = build({ replies: [answer(decision({ candidateId: workflow?.id }))] })
    const result = await advisor.refine({ path: PATH, content, scope: SCOPE, candidates: twoFindings })

    expect(result.ok).toBe(true)
    if (!result.ok) {return}
    expect(result.value.recommendations.map(r => r.candidateIds)).toEqual([[workflow?.id]])
    expect(result.value.skipped).toEqual([{ candidateId: authorization?.id, reason: 'the advisor did not decide on this finding' }])
  })

  it('rejects an invented candidate id and asks again with the reason', async () => {
    const { advisor, model } = build({
      replies: [answer(decision({ candidateId: 'c99' })), answer(decision())],
    })
    const result = await advisor.refine({ path: PATH, content: CONTROLLER, scope: SCOPE, candidates: findings() })

    expect(result.ok).toBe(true)
    expect(model.prompts[1]).toContain('"c99" is not one of the findings')
  })

  it('rejects a technique that did not pass its validators for this finding', async () => {
    const { advisor, model } = build({
      replies: [answer(decision({ technique: 'strategy' })), answer(decision())],
    })
    const result = await advisor.refine({ path: PATH, content: CONTROLLER, scope: SCOPE, candidates: findings() })

    expect(result.ok).toBe(true)
    expect(model.prompts[1]).toContain('technique "strategy" is not allowed for this finding')
  })

  it('rejects a recommendation that names a file outside the allowed roots, after one retry', async () => {
    const { advisor, model } = build({
      replies: [answer(decision({ affectedFiles: ['config/routes.rb'] })), answer(decision({ affectedFiles: ['config/routes.rb'] }))],
    })
    const result = await advisor.refine({ path: PATH, content: CONTROLLER, scope: SCOPE, candidates: findings() })

    expect(result).toMatchObject({ ok: false, reason: 'unsafe-path' })
    expect(model.prompts).toHaveLength(2)
  })

  it('rejects an empty decision list: each finding must be decided', async () => {
    const { advisor } = build({ replies: ['{"decisions": []}', '{"decisions": []}'] })
    const result = await advisor.refine({ path: PATH, content: CONTROLLER, scope: SCOPE, candidates: findings() })
    expect(result).toMatchObject({ ok: false, reason: 'invalid-response' })
  })

  it('reports a provider failure without retrying', async () => {
    const { advisor, model } = build({ replies: [{ success: false, response: 'No Ollama at localhost:11434' }] })
    const result = await advisor.refine({ path: PATH, content: CONTROLLER, scope: SCOPE, candidates: findings() })
    expect(result).toEqual({ ok: false, reason: 'model-unavailable', message: 'No Ollama at localhost:11434' })
    expect(model.prompts).toHaveLength(1)
  })

  it('refuses a primary file outside the allowed roots without calling the model', async () => {
    const { advisor, model } = build({ replies: [] })
    const result = await advisor.refine({ path: 'config/application.rb', content: CONTROLLER, scope: SCOPE, candidates: findings() })
    expect(result).toMatchObject({ ok: false, reason: 'unsafe-path' })
    expect(model.prompts).toHaveLength(0)
  })

  it('shows the model the measured evidence and the allowed techniques, not free-form findings', async () => {
    const { advisor, model } = build({ replies: [answer(decision())] })
    await advisor.refine({ path: PATH, content: CONTROLLER, scope: SCOPE, candidates: findings() })
    const prompt = model.prompts[0]
    expect(prompt).toContain('c1 [rails.controller-workflow')
    expect(prompt).toContain('allowed techniques: service-object (Service Object)')
    expect(prompt).toContain('TARGET (method OrdersController#create')
    expect(prompt).toContain('Only list files from CONTEXT')
  })
})

describe('RefactoringAdvisor.plan: a diff is previewed only when it proves safe', () => {
  const recommendation: Recommendation = {
    id: 'r1',
    source: 'ai',
    candidateIds: ['c1'],
    path: PATH,
    scope: { kind: 'method', name: 'create', className: 'OrdersController', startLine: 2, endLine: 14 },
    title: 'Service Object: OrdersController#create',
    problem: 'Action create runs a 4-collaborator workflow inside the controller',
    evidence: [],
    confidence: 'medium',
    priority: 'high',
    technique: { id: 'service-object', name: 'Service Object' },
    design: 'Move the workflow into CreateOrder.',
    alternatives: [],
    benefit: 'Testable workflow.',
    risk: 'Order of side effects.',
    affectedFiles: [PATH, 'app/services/create_order.rb'],
    steps: ['Create CreateOrder', 'Call it from create'],
    verification: ['Run the request spec'],
  }

  const DIFF = [
    '--- a/app/controllers/orders_controller.rb',
    '+++ b/app/controllers/orders_controller.rb',
    '@@ -5,5 +5,5 @@',
    '     if @order.save',
    '       InventoryService.new.reserve(@order)',
    '-      PaymentGateway.new.charge(@order)',
    '+      CreateOrder.call(@order)',
    '       OrderMailer.confirmation(@order).deliver_later',
    ' ',
    '--- /dev/null',
    '+++ b/app/services/create_order.rb',
    '@@ -0,0 +1,5 @@',
    '+class CreateOrder',
    '+  def self.call(order)',
    '+    order',
    '+  end',
    '+end',
  ].join('\n')

  it('produces the exact changes and writes nothing', async () => {
    const { advisor, model, files } = build({ replies: [DIFF] })
    const before = new Map(files)
    const result = await advisor.plan(recommendation)

    expect(result.ok).toBe(true)
    if (!result.ok) {return}
    expect(result.value.changes).toEqual([
      {
        path: PATH,
        kind: 'modify',
        before: CONTROLLER,
        after: CONTROLLER.replace('      PaymentGateway.new.charge(@order)', '      CreateOrder.call(@order)'),
      },
      {
        path: 'app/services/create_order.rb',
        kind: 'create',
        before: undefined,
        after: 'class CreateOrder\n  def self.call(order)\n    order\n  end\nend\n',
      },
    ])
    expect(model.prompts[0]).toContain('=== app/services/create_order.rb ===\n(does not exist yet)')
    expect(files).toEqual(before)
  })

  it('refuses a plan for files totalling more than the apply limit, without calling the model', async () => {
    const huge = `class OrdersController\n${'  x = 1\n'.repeat(3000)}end\n`
    const { advisor, model } = build({ replies: [], files: { [PATH]: huge } })
    expect(await advisor.plan({ ...recommendation, affectedFiles: [PATH] })).toMatchObject({ ok: false, reason: 'too-large' })
    expect(model.prompts).toHaveLength(0)
  })

  it('refuses a recommendation whose stored paths are unsafe, without reading or calling the model', async () => {
    const { advisor, model } = build({ replies: [] })
    expect(await advisor.plan({ ...recommendation, affectedFiles: ['db/schema.rb'] })).toMatchObject({ ok: false, reason: 'unsafe-path' })
    expect(model.prompts).toHaveLength(0)
  })

  it('retries once when the diff does not apply, and reports a syntax error with the file name', async () => {
    const broken = DIFF.replace('+      CreateOrder.call(@order)', '+      BROKEN(@order')
    const { advisor, model } = build({
      replies: [broken, DIFF],
      syntax: code => (code.includes('BROKEN') ? { status: 'error', message: 'syntax error' } : { status: 'ok' }),
    })
    const result = await advisor.plan(recommendation)
    expect(result.ok).toBe(true)
    expect(model.prompts[1]).toContain('would not parse as Ruby')
  })
})
