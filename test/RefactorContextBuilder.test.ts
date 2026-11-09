import { describe, it, expect } from 'vitest'
import { RefactoringContextBuilder as ContextBuilder, clip } from '../src/refactoring-intelligence/core/RefactoringContextBuilder'
import { ADVISOR_LIMITS, RefactorTarget } from '../src/refactoring-intelligence/core/types'

function harness(options: {
  files: Record<string, string>
  definitions?: Record<string, string[]>
  callers?: Record<string, string[]>
  instances?: Array<{ name: string; filePath: string; publicMethods: string[] }>
}) {
  const definitions = options.definitions ?? {}
  const callers = options.callers ?? {}
  return new ContextBuilder(
    {
      findDefiningFiles: (name: string) => (definitions[name] ?? []).map(relativePath => ({ relativePath })),
      incomingDependencies: (toPath: string) => (callers[toPath] ?? []).map(fromPath => ({ fromPath })),
    },
    { read: async path => options.files[path] },
    {
      listCatalog: () => [],
      listProjectInstances: () => options.instances ?? [],
    },
  )
}

const target = (text: string): RefactorTarget => ({ kind: 'method', name: 'charge', className: 'Order', startLine: 1, endLine: 3, text })

describe('ContextBuilder', () => {
  it('includes the primary file whole when it fits the primary-file limit', async () => {
    const content = 'class Order\n  def charge; end\nend\n'
    const ctx = await harness({ files: {} }).build({ relativePath: 'app/models/order.rb', content, target: target('  def charge; end') })
    expect(ctx.primarySource).toBe(content)
  })

  it('omits the primary file when it is too large, leaving the target to stand in for it', async () => {
    const content = `class Order\n${'  # padding\n'.repeat(ADVISOR_LIMITS.primaryFileMaxChars)}end\n`
    const ctx = await harness({ files: {} }).build({ relativePath: 'app/models/order.rb', content, target: target('  def charge; end') })
    expect(ctx.primarySource).toBeUndefined()
  })

  it('finds the files that define the constants the target references, most-referenced first', async () => {
    const ctx = await harness({
      files: {
        'app/services/payment_gateway.rb': 'class PaymentGateway; end\n',
        'app/services/tax_calculator.rb': 'class TaxCalculator; end\n',
      },
      definitions: {
        PaymentGateway: ['app/services/payment_gateway.rb'],
        TaxCalculator: ['app/services/tax_calculator.rb'],
      },
    }).build({
      relativePath: 'app/models/order.rb',
      content: 'class Order; end\n',
      target: target('  def charge\n    PaymentGateway.call(amount)\n    PaymentGateway.log\n    TaxCalculator.new\n  end'),
    })

    expect(ctx.related.map(r => [r.path, r.referencedAs])).toEqual([
      ['app/services/payment_gateway.rb', ['PaymentGateway']],
      ['app/services/tax_calculator.rb', ['TaxCalculator']],
    ])
  })

  it('does not treat the primary file as related to itself', async () => {
    const ctx = await harness({
      files: { 'app/models/order.rb': 'class Order; end\n' },
      definitions: { Order: ['app/models/order.rb'] },
    }).build({ relativePath: 'app/models/order.rb', content: 'class Order; end\n', target: target('  Order.new') })

    expect(ctx.related).toEqual([])
  })

  it('ignores constant-looking tokens that are method calls or instance variables', async () => {
    const ctx = await harness({
      files: { 'app/services/fake.rb': 'class Fake; end\n' },
      definitions: { Fake: ['app/services/fake.rb'] },
    }).build({
      relativePath: 'app/models/order.rb',
      content: 'x',
      target: target('  record.Fake\n  @Fake = 1\n  obj.Fake(2)'),
    })

    expect(ctx.related).toEqual([])
  })

  it('reads namespaced constants as one reference', async () => {
    const ctx = await harness({
      files: { 'lib/payments/gateway.rb': 'module Payments; class Gateway; end; end\n' },
      definitions: { 'Payments::Gateway': ['lib/payments/gateway.rb'] },
    }).build({ relativePath: 'app/models/order.rb', content: 'x', target: target('  Payments::Gateway.call') })

    expect(ctx.related.map(r => r.referencedAs)).toEqual([['Payments::Gateway']])
  })

  it('keeps the total context within the budget, dropping lower-ranked files first', async () => {
    const big = 'x'.repeat(ADVISOR_LIMITS.excerptMaxChars * 2)
    const content = 'class Order\n' + 'y'.repeat(ADVISOR_LIMITS.primaryFileMaxChars - 20) + '\nend\n'
    const files: Record<string, string> = {}
    const definitions: Record<string, string[]> = {}
    for (let i = 0; i < 4; i++) {
      files[`app/services/s${i}.rb`] = big
      definitions[`S${i}`] = [`app/services/s${i}.rb`]
    }
    const ctx = await harness({ files, definitions }).build({
      relativePath: 'app/models/order.rb',
      content,
      target: target('  S0.a\n  S1.b\n  S2.c\n  S3.d'),
    })

    const relatedTotal = ctx.related.reduce((sum, r) => sum + r.excerpt.length, 0)
    const primaryTotal = ctx.primarySource?.length ?? 0
    expect(relatedTotal + primaryTotal).toBeLessThanOrEqual(ADVISOR_LIMITS.suggestContextMaxChars)
    expect(ctx.related.length).toBeLessThan(4)
  })

  it('includes the conventional spec file when it exists', async () => {
    const ctx = await harness({
      files: { 'spec/models/order_spec.rb': "RSpec.describe Order do\nend\n" },
    }).build({ relativePath: 'app/models/order.rb', content: 'class Order; end\n', target: target('  def charge; end') })

    expect(ctx.specs.map(s => s.path)).toEqual(['spec/models/order_spec.rb'])
    expect(ctx.specs[0].excerpt).toContain('RSpec.describe Order')
  })

  it('lists callers without the file itself, unique and sorted, capped at the limit', async () => {
    const ctx = await harness({
      files: {},
      callers: {
        'app/models/order.rb': [
          'app/controllers/orders_controller.rb',
          'app/models/order.rb',
          'app/controllers/orders_controller.rb',
          'app/jobs/billing_job.rb',
          'app/mailers/receipt_mailer.rb',
          'app/views/orders/show.rb',
        ],
      },
    }).build({ relativePath: 'app/models/order.rb', content: 'class Order; end\n', target: target('  def charge; end') })

    expect(ctx.callers).toEqual([
      'app/controllers/orders_controller.rb',
      'app/jobs/billing_job.rb',
      'app/mailers/receipt_mailer.rb',
    ])
  })

  it('describes existing project pattern instances with their key public methods', async () => {
    const ctx = await harness({
      files: {},
      instances: [{ name: 'PaymentService', filePath: 'app/services/payment_service.rb', publicMethods: ['call', 'refund'] }],
    }).build({ relativePath: 'app/models/order.rb', content: 'class Order; end\n', target: target('  def charge; end') })

    expect(ctx.conventions).toEqual(['PaymentService (app/services/payment_service.rb): call, refund'])
  })
})

describe('clip', () => {
  it('returns short text unchanged', () => {
    expect(clip('abc', 10)).toBe('abc')
  })

  it('cuts long text and states how much was dropped', () => {
    expect(clip('abcdefghij', 4)).toBe('abcd\n# ...[truncated: 6 more characters]')
  })
})
