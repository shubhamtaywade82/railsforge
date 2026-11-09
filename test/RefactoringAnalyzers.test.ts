import { describe, it, expect } from 'vitest'
import { RubyAstParser } from '../src/indexer/RubyAstParser'
import { collectCandidates, CollectInput } from '../src/refactoring-intelligence/analyzers/CandidateCollector'
import { branchPoints, collaboratorRefs, nestingDepth, parameterCount, receiverCalls } from '../src/refactoring-intelligence/analyzers/metrics'
import type { Candidate, CandidateKind } from '../src/refactoring-intelligence/core/types'

const parser = new RubyAstParser()

function run(path: string, content: string, extra: Partial<CollectInput> = {}): Candidate[] {
  return collectCandidates(parser, { path, content, ...extra })
}

function kinds(candidates: readonly Candidate[]): CandidateKind[] {
  return candidates.map(c => c.kind)
}

function find(candidates: readonly Candidate[], kind: CandidateKind): Candidate | undefined {
  return candidates.find(c => c.kind === kind)
}

/** A class with one method whose body has `n` code lines (def and end are not counted). */
function oneMethod(n: number, name = 'work', params = ''): string {
  return ['class Worker', `  def ${name}${params ? `(${params})` : ''}`, ...Array.from({ length: n }, (_, i) => `    value_${i} = ${i}`), '  end', 'end', ''].join('\n')
}

const CONTROLLER_EXAMPLE = [
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

describe('controller workflow (Level 2 example from the brief)', () => {
  it('finds OrdersController#create coordinating four collaborators with persistence and effects', () => {
    const c = find(run('app/controllers/orders_controller.rb', CONTROLLER_EXAMPLE), 'rails.controller-workflow')
    expect(c).toBeDefined()
    expect(c).toMatchObject({ anchor: 'method', className: 'OrdersController', methodName: 'create', severity: 3, strength: 'moderate' })
    expect(c?.metrics.collaborators).toEqual(['InventoryService', 'Order', 'OrderMailer', 'PaymentGateway'])
    expect(c?.evidence[0].path).toBe('app/controllers/orders_controller.rb')
  })

  it('ignores private helpers in a controller', () => {
    const source = CONTROLLER_EXAMPLE.replace('  def create', '  private\n\n  def create')
    expect(kinds(run('app/controllers/orders_controller.rb', source))).not.toContain('rails.controller-workflow')
  })

  it('does not fire for a read-only action that only calls one collaborator', () => {
    const source = ['class OrdersController < ApplicationController', '  def show', '    @order = Order.find(params[:id])', '    @summary = OrderSummary.new(@order).render', '  end', 'end', ''].join('\n')
    expect(kinds(run('app/controllers/orders_controller.rb', source))).not.toContain('rails.controller-workflow')
  })
})

describe('method analyzer', () => {
  it('flags a method at the long threshold (15 code lines) and not below it', () => {
    expect(kinds(run('app/services/worker.rb', oneMethod(15)))).toContain('method.long')
    expect(kinds(run('app/services/worker.rb', oneMethod(14)))).not.toContain('method.long')
  })

  it('raises long-method severity to high at 30 code lines', () => {
    expect(find(run('app/services/worker.rb', oneMethod(30)), 'method.long')?.severity).toBe(3)
  })

  it('measures nesting from the body: three levels fire, two do not', () => {
    const deep = ['class A', '  def run', '    if a', '      items.each do |i|', '        if i', '          i.go', '        end', '      end', '    end', '  end', 'end'].join('\n')
    const shallow = ['class A', '  def run', '    if a', '      i.go', '    end', '  end', 'end'].join('\n')
    expect(find(run('app/services/a.rb', deep), 'method.deep-nesting')?.metrics.depth).toBe(3)
    expect(kinds(run('app/services/a.rb', shallow))).not.toContain('method.deep-nesting')
  })

  it('counts parameters at the def line and flags four or more', () => {
    expect(find(run('app/services/worker.rb', oneMethod(2, 'work', 'a, b, c, d')), 'method.many-parameters')?.metrics.parameters).toBe(4)
    expect(kinds(run('app/services/worker.rb', oneMethod(2, 'work', 'a, b, c')))).not.toContain('method.many-parameters')
  })

  it('finds a conditional chain on one discriminator with non-trivial branches', () => {
    const source = [
      'class Checkout',
      '  def charge(payment_type, amount)',
      "    if payment_type == 'card'",
      '      fee = amount * 0.02',
      '      gateway.card_charge(amount + fee)',
      "    elsif payment_type == 'upi'",
      '      fee = 0',
      '      gateway.upi_charge(amount + fee)',
      "    elsif payment_type == 'wallet'",
      '      wallet.debit(amount)',
      '      audit(amount)',
      '    end',
      '  end',
      'end',
    ].join('\n')
    const c = find(run('app/services/checkout.rb', source), 'method.conditional-chain')
    expect(c?.metrics).toMatchObject({ discriminator: 'payment_type', discriminatorBranches: 3, nonTrivialBranches: 3 })
  })

  it('finds a Ruby case/when whose `when` lines sit at the same indent as `case` (regression)', () => {
    const source = [
      'class Payment',
      '  def label',
      '    case payment_type',
      "    when 'card'",
      '      describe_card',
      '      format_card',
      "    when 'upi'",
      '      describe_upi',
      '      format_upi',
      "    when 'wallet'",
      '      describe_wallet',
      '      format_wallet',
      '    end',
      '  end',
      'end',
    ].join('\n')
    expect(find(run('app/services/payment.rb', source), 'method.conditional-chain')?.metrics.discriminatorBranches).toBe(3)
  })

  it('does not treat a lookup of one-line branches as behaviour (the candidate exists; the technique will reject it)', () => {
    const source = ['class Payment', '  def label', '    case payment_type', "    when 'card' then 'Card'", "    when 'upi' then 'UPI'", "    when 'wallet' then 'Wallet'", '    end', '  end', 'end'].join('\n')
    expect(find(run('app/services/payment.rb', source), 'method.conditional-chain')?.metrics.nonTrivialBranches).toBe(0)
  })

  it('flags a method that coordinates collaborators and persists in a non-controller file', () => {
    const source = ['class Settle', '  def call(order)', '    Ledger.new.post(order)', '    Tax.calculate(order)', '    order.save!', '  end', 'end'].join('\n')
    const c = find(run('app/services/settle.rb', source), 'method.mixed-collaborators')
    expect(c?.metrics.collaborators).toEqual(['Ledger', 'Tax'])
  })

  it('flags feature envy: many calls on one foreign receiver and almost none on its own class', () => {
    const source = ['class Report', '  def summary(order)', '    order.total + order.tax + order.discount + order.shipping', '  end', 'end'].join('\n')
    expect(find(run('app/services/report.rb', source), 'method.feature-envy')?.metrics.receivers).toEqual(['order'])
  })

  it('flags a query chain of four or more relation calls', () => {
    const source = ['class Finder', '  def run', '    Order.where(a: 1).joins(:x).order(:id).includes(:y).limit(5)', '  end', 'end'].join('\n')
    expect(find(run('app/services/finder.rb', source), 'method.complex-query')?.metrics.queryCalls).toBe(5)
  })
})

describe('class analyzer', () => {
  it('flags a class of 250 lines and raises it to high at 500', () => {
    const big = (n: number) => ['class Big', ...Array.from({ length: n - 2 }, () => '  x = 1'), 'end', ''].join('\n')
    expect(find(run('app/services/big.rb', big(250)), 'class.large')?.severity).toBe(2)
    expect(find(run('app/services/big.rb', big(500)), 'class.large')?.severity).toBe(3)
    expect(kinds(run('app/services/big.rb', big(249)))).not.toContain('class.large')
  })

  it('flags 15 or more methods', () => {
    const many = (n: number) => ['class Many', ...Array.from({ length: n }, (_, i) => `  def m${i}; end`), 'end', ''].join('\n')
    expect(find(run('app/models/many.rb', many(15)), 'class.many-methods')?.metrics.methods).toBe(15)
    expect(kinds(run('app/models/many.rb', many(14)))).not.toContain('class.many-methods')
  })

  it('flags two project collaborators created with .new, and ignores standard-library constants', () => {
    const source = ['class Billing', '  def run', '    Hash.new', '    Array.new', '    Mailer.new', '    Ledger.new', '  end', 'end'].join('\n')
    expect(find(run('app/services/billing.rb', source), 'class.hard-wired-collaborators')?.metrics.instantiated).toEqual(['Ledger', 'Mailer'])
    const onlyStdlib = ['class Billing', '  def run', '    Hash.new', '    Array.new', '  end', 'end'].join('\n')
    expect(kinds(run('app/services/billing.rb', onlyStdlib))).not.toContain('class.hard-wired-collaborators')
  })

  it('uses the project-type predicate to exclude constants that are not defined in the project', () => {
    const source = ['class Billing', '  def run', '    Mailer.new', '    Ledger.new', '  end', 'end'].join('\n')
    const onlyLedger = run('app/services/billing.rb', source, { isProjectType: name => name === 'Ledger' })
    expect(kinds(onlyLedger)).not.toContain('class.hard-wired-collaborators')
  })

  it('does not raise hard-wired collaborators for controllers (the workflow rule owns them)', () => {
    const source = ['class OrdersController < ApplicationController', '  def a', '    Foo.new', '    Bar.new', '  end', 'end'].join('\n')
    expect(kinds(run('app/controllers/orders_controller.rb', source))).not.toContain('class.hard-wired-collaborators')
  })

  it('flags four or more lifecycle callbacks', () => {
    const cb = (n: number) => ['class Order < ApplicationRecord', ...Array.from({ length: n }, (_, i) => `  before_save :step_${i}`), 'end', ''].join('\n')
    expect(find(run('app/models/order.rb', cb(4)), 'class.callback-heavy')?.metrics.callbacks).toBe(4)
    expect(kinds(run('app/models/order.rb', cb(3)))).not.toContain('class.callback-heavy')
  })

  it('counts only callbacks whose method or block performs a side effect', () => {
    const source = [
      'class Order < ApplicationRecord',
      '  after_commit :send_receipt',
      '  after_create :notify_warehouse',
      '  before_validation :normalise',
      '  before_save :stamp',
      '  def send_receipt',
      '    OrderMailer.receipt(self).deliver_later',
      '  end',
      '  def notify_warehouse',
      '    WarehouseClient.new.publish(self)',
      '  end',
      '  def normalise; end',
      '  def stamp; end',
      'end',
    ].join('\n')
    expect(find(run('app/models/order.rb', source), 'class.side-effect-callbacks')?.metrics.sideEffectCallbacks).toBe(2)
  })

  it('does not count a normalising-only callback set as side effects', () => {
    const source = ['class Order < ApplicationRecord', '  before_validation :normalise', '  before_save :stamp', '  def normalise; end', '  def stamp; end', 'end'].join('\n')
    expect(kinds(run('app/models/order.rb', source))).not.toContain('class.side-effect-callbacks')
  })
})

describe('rails analyzer', () => {
  it('flags inline authorization checked in three or more places in a controller', () => {
    const source = ['class OrdersController < ApplicationController', '  def a', '    authorize! :read, @order', '  end', '  def b', '    return head :forbidden unless current_user.admin?', '  end', '  def c', '    raise unless can?(:edit, @order)', '  end', 'end'].join('\n')
    expect(find(run('app/controllers/orders_controller.rb', source), 'rails.inline-authorization')?.metrics.authChecks).toBe(3)
  })

  it('reports N+1 reads only when the schema tables are known', () => {
    const source = ['class Report', '  def run', '    Order.where(status: "paid").each do |order|', '      puts order.customer.name', '    end', '  end', 'end'].join('\n')
    expect(kinds(run('app/services/report.rb', source))).not.toContain('rails.n-plus-one')
    const found = find(run('app/services/report.rb', source, { schemaTables: [{ name: 'orders', columns: ['customer_id'] }, { name: 'customers', columns: ['name'] }] }), 'rails.n-plus-one')
    expect(found?.metrics.nPlusOne).toMatchObject({ collection: 'Order.where(status: "paid")', variable: 'order', association: 'customer' })
    expect(found?.methodName).toBe('run')
  })

  it('flags view helpers in a model, but not in a controller', () => {
    const model = ['class Order < ApplicationRecord', '  def formatted_total', '    helpers.number_to_currency(total)', '  end', 'end'].join('\n')
    expect(kinds(run('app/models/order.rb', model))).toContain('rails.presentation-in-model')
    expect(kinds(run('app/controllers/orders_controller.rb', model))).not.toContain('rails.presentation-in-model')
  })
})

describe('duplication and principle analyzers', () => {
  it('finds methods with identical bodies, ignoring their names', () => {
    const source = ['class Pricing', '  def gross_a(x)', '    base = x * 2', '    tax = base * 0.2', '    base + tax', '  end', '  def gross_b(x)', '    base = x * 2', '    tax = base * 0.2', '    base + tax', '  end', 'end'].join('\n')
    const c = find(run('app/services/pricing.rb', source), 'method.duplicate')
    expect(c).toMatchObject({ methodName: 'gross_a', strength: 'strong' })
    expect(c?.metrics.duplicateOf).toEqual(['gross_b'])
  })

  it('does not flag methods whose bodies differ', () => {
    const source = ['class Pricing', '  def a(x)', '    base = x * 2', '    tax = base * 0.2', '    base + tax', '  end', '  def b(x)', '    base = x * 3', '    tax = base * 0.2', '    base + tax', '  end', 'end'].join('\n')
    expect(kinds(run('app/services/pricing.rb', source))).not.toContain('method.duplicate')
  })

  it('lifts design-principle findings into candidates, anchored on the class for SRP, and drops unmapped findings', () => {
    const source = ['class Fat', '  def a; end', 'end', ''].join('\n')
    const result = run('app/services/fat.rb', source, {
      principleFindings: [
        { id: 'SRP-FAT-CLASS', title: 'Fat class', message: 'Too many responsibilities', line: 1, severity: 1 },
        { id: 'KISS-METAPROGRAMMING', title: 'Meta', message: 'Avoid define_method', line: 2, severity: 2 },
      ],
    })
    expect(result.map(c => c.kind)).toEqual(['principle.srp-fat-class'])
    expect(result[0]).toMatchObject({ anchor: 'class', className: 'Fat', severity: 2 })
  })
})

describe('collector', () => {
  it('assigns ids c1, c2, ... in severity order', () => {
    const result = run('app/controllers/orders_controller.rb', CONTROLLER_EXAMPLE)
    expect(result.map(c => c.id)).toEqual(result.map((_, i) => `c${i + 1}`))
    const severities = result.map(c => c.severity)
    expect([...severities].sort((a, b) => b - a)).toEqual(severities)
  })

  it('returns nothing for code that has no measurable problem', () => {
    expect(run('app/services/tiny.rb', 'class Tiny\n  def ok\n    1\n  end\nend\n')).toEqual([])
  })
})

describe('metrics', () => {
  it('counts branch points, including modifier forms, and ignores comments', () => {
    expect(branchPoints(['if a', 'elsif b', '# if commented', 'return 1 unless c'])).toBe(3)
  })

  it('measures nesting relative to the method body', () => {
    expect(nestingDepth(['def a', 'if x', 'end', 'end'])).toBe(1)
    expect(nestingDepth(['def a', 'if x', 'while y', 'end', 'end', 'end'])).toBe(2)
  })

  it('counts parameters, including keyword and block parameters, and none for a bare def', () => {
    expect(parameterCount('  def run(a, b:, &blk)')).toBe(3)
    expect(parameterCount('  def run')).toBe(0)
  })

  it('reports distinct receivers, excluding self and framework request objects', () => {
    expect(receiverCalls('self.a; params.fetch(:x); order.total; order.tax; user.name')).toEqual({ receivers: ['order', 'user'], count: 3 })
  })

  it('separates instantiated from called project constants and ignores standard-library names', () => {
    expect(collaboratorRefs('A.new; B.call(1); Hash.new; C.run; Payments::Gateway.new')).toEqual({
      instantiated: ['A', 'Payments::Gateway'],
      called: ['B', 'C'],
    })
  })
})
