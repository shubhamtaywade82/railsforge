/**
 * PatternCatalog - RailsForge's own, original explanations of the design patterns that matter in
 * Ruby on Rails code, rendered in-editor (`railsforge:/pattern/<id>.md`) and used as the only
 * context for the "Explain pattern" AI action.
 *
 * The text and examples here are written for RailsForge. Refactoring.Guru is referenced by link
 * only: its articles and example code are CC BY-NC-ND and must not be copied or adapted into the
 * extension. Pure module (no vscode import) so it is unit-tested.
 */

import { IndexedPattern, PatternType } from './ProjectPatternIndexer'

export type PatternCategory = 'rails' | 'behavioral' | 'structural' | 'creational'

export interface CatalogPattern {
  id: string
  category: PatternCategory
  name: string
  /** One line, shown beside the tree node. */
  summary: string
  intent: string
  whenToUse: string[]
  watchOutFor: string[]
  /** Ruby source, original to this project. */
  example: string
  /** Project directory kind whose classes are listed as "in this project". */
  projectKind?: PatternType
  /** Command that scaffolds a new instance of the pattern. */
  generateCommand?: string
  /** Ids of closely related catalog entries. */
  related?: string[]
  reference?: { label: string; url: string }
}

export const CATEGORY_LABELS: Record<PatternCategory, string> = {
  rails: 'Rails Idiomatic Patterns',
  behavioral: 'Behavioral Patterns',
  structural: 'Structural Patterns',
  creational: 'Creational Patterns',
}

export const CATEGORY_ORDER: readonly PatternCategory[] = ['rails', 'behavioral', 'structural', 'creational']

const guru = (slug: string): { label: string; url: string } => ({
  label: 'Refactoring.Guru',
  url: `https://refactoring.guru/design-patterns/${slug}`,
})

export const PATTERN_CATALOG: readonly CatalogPattern[] = [
  {
    id: 'service-object',
    category: 'rails',
    name: 'Service Object',
    summary: 'app/services — one business operation per class',
    intent: 'Move a multi-step business operation out of a controller or model into a plain Ruby class with a single entry point, so it can be tested without HTTP or persistence glue.',
    whenToUse: [
      'A controller action coordinates several models, mailers or external calls.',
      'The same workflow is triggered from a controller, a job and a console task.',
      'A model callback does work that is not about the model\'s own consistency.',
    ],
    watchOutFor: [
      'A "service" that is really a bag of unrelated methods — keep one verb per class (`Orders::Place`, not `OrderService`).',
      'Returning true/false and losing the reason; return a result object or raise a domain error.',
      'Hidden transactions: wrap the whole operation in one explicit transaction, not one per step.',
    ],
    example: `module Orders
  class Place
    Result = Struct.new(:order, :error, keyword_init: true) do
      def success? = error.nil?
    end

    def self.call(...) = new(...).call

    def initialize(cart:, user:)
      @cart = cart
      @user = user
    end

    def call
      order = Order.transaction do
        Order.create!(user: @user, lines: @cart.lines_attributes).tap { @cart.clear! }
      end
      OrderMailer.confirmation(order).deliver_later
      Result.new(order: order)
    rescue ActiveRecord::RecordInvalid => e
      Result.new(error: e.message)
    end
  end
end`,
    projectKind: 'service',
    generateCommand: 'railsforge.generateServiceObject',
    related: ['command', 'form-object'],
    reference: guru('command'),
  },
  {
    id: 'query-object',
    category: 'rails',
    name: 'Query Object',
    summary: 'app/queries — a named, testable ActiveRecord query',
    intent: 'Give a non-trivial query (joins, grouping, conditional filters) a name and a home, instead of growing chains of scopes or class methods on the model.',
    whenToUse: [
      'A query needs three or more joins or several optional filters.',
      'Scopes on the model are being combined in ways that only one caller needs.',
      'You want to test the query against real rows without loading the whole controller stack.',
    ],
    watchOutFor: [
      'Returning an Array instead of a relation — callers lose `.page`, `.includes` and lazy evaluation.',
      'Query objects that perform writes; keep them read-only.',
      'Duplicating a scope that already exists on the model — reuse it from inside the object.',
    ],
    example: `class ActiveCustomersQuery
  def initialize(relation = User.all)
    @relation = relation
  end

  def call(since: 30.days.ago)
    @relation
      .joins(:orders)
      .where(orders: { created_at: since.. })
      .group('users.id')
      .having('COUNT(orders.id) >= 2')
  end
end`,
    projectKind: 'query',
    related: ['service-object'],
  },
  {
    id: 'form-object',
    category: 'rails',
    name: 'Form Object',
    summary: 'app/forms — validations for one screen, many models',
    intent: 'Wrap a form that creates or updates several records (or none) in an ActiveModel object that owns its own validations and persistence.',
    whenToUse: [
      'One screen writes to two or more models and `accepts_nested_attributes_for` is getting awkward.',
      'Validations apply to a particular workflow, not to the model in every context.',
      'The submitted data does not map to a table at all (search filters, contact forms).',
    ],
    watchOutFor: [
      'Duplicating model validations; delegate to the models where the rule is universal.',
      'Forgetting `ActiveModel::Model` so `form_with` and error rendering do not work.',
      'Saving partially: persist inside one transaction and return false on any failure.',
    ],
    example: `class SignupForm
  include ActiveModel::Model
  include ActiveModel::Attributes

  attribute :email, :string
  attribute :password, :string
  attribute :company_name, :string

  validates :email, :password, :company_name, presence: true

  def save
    return false unless valid?

    ActiveRecord::Base.transaction do
      company = Company.create!(name: company_name)
      company.users.create!(email: email, password: password)
    end
    true
  rescue ActiveRecord::RecordInvalid => e
    errors.add(:base, e.message)
    false
  end
end`,
    projectKind: 'form',
    related: ['service-object'],
  },
  {
    id: 'value-object',
    category: 'rails',
    name: 'Value Object',
    summary: 'Immutable domain value, compared by content',
    intent: 'Represent a small domain concept (money, a date range, an email address) as an immutable object whose identity is its value, instead of passing raw primitives around.',
    whenToUse: [
      'The same pair of primitives (amount + currency, start + end) always travels together.',
      'Validation or formatting of a primitive is repeated in several places.',
      'You want equality and hashing based on content.',
    ],
    watchOutFor: [
      'Mutating methods; return new instances instead.',
      'Over-wrapping every string — only wrap values that carry rules.',
      'Forgetting to persist via `composed_of`, a custom attribute type, or by storing the raw columns.',
    ],
    example: `Money = Data.define(:cents, :currency) do
  def +(other)
    raise ArgumentError, 'currency mismatch' unless currency == other.currency

    with(cents: cents + other.cents)
  end

  def to_s = format('%.2f %s', cents / 100.0, currency)
end

Money.new(cents: 1250, currency: 'USD') + Money.new(cents: 250, currency: 'USD')`,
    reference: { label: 'Refactoring.Guru — Primitive Obsession', url: 'https://refactoring.guru/smells/primitive-obsession' },
  },
  {
    id: 'policy-object',
    category: 'rails',
    name: 'Policy Object',
    summary: 'app/policies — who may do what, in one place',
    intent: 'Collect authorization rules for a resource into a class with one predicate per action, so controllers and views ask a question instead of encoding the rule.',
    whenToUse: [
      'Permission checks are repeated across controllers, views and jobs.',
      'Rules depend on both the user and the record (owner, role, state).',
      'You use Pundit or want the same shape without the gem.',
    ],
    watchOutFor: [
      'Authorizing only in the view; always enforce in the controller or service too.',
      'Policies that query the database for every check; load once and reuse.',
      'Forgetting a policy scope for index actions — filtering must not rely on the UI.',
    ],
    example: `class PostPolicy
  attr_reader :user, :post

  def initialize(user, post)
    @user = user
    @post = post
  end

  def update?  = user.admin? || post.author_id == user.id
  def destroy? = user.admin?
end`,
    projectKind: 'policy',
    related: ['strategy'],
  },
  {
    id: 'strategy',
    category: 'behavioral',
    name: 'Strategy',
    summary: 'Swap an algorithm without conditionals',
    intent: 'Put each variant of an algorithm behind the same small interface and let the caller choose which one to use, replacing a growing `case` over a type.',
    whenToUse: [
      'A method branches on a type or option to run different logic (pricing, export format, notifier).',
      'New variants are added regularly and must not touch existing code.',
      'The choice is made at runtime from configuration or data.',
    ],
    watchOutFor: [
      'Two variants do not justify a pattern; wait for the third.',
      'Strategies that need so much shared state they should be one class.',
      'A hash of lambdas is often enough in Ruby.',
    ],
    example: `class Shipping
  RATES = {
    standard: ->(order) { 5_00 },
    express:  ->(order) { 15_00 + order.weight_kg * 100 },
    pickup:   ->(_order) { 0 }
  }.freeze

  def self.cost(order, method:)
    RATES.fetch(method).call(order)
  end
end`,
    related: ['policy-object', 'state'],
    reference: guru('strategy'),
  },
  {
    id: 'command',
    category: 'behavioral',
    name: 'Command',
    summary: 'A request as an object you can queue or undo',
    intent: 'Package an action and its parameters into an object so it can be validated, queued, logged, retried or undone independently of who requested it.',
    whenToUse: [
      'Work moves to a background job and must be reproducible from its arguments.',
      'You need an audit trail or undo for user actions.',
      'Several entry points (UI, API, console) trigger the same action.',
    ],
    watchOutFor: [
      'Non-serializable arguments; pass ids, not records, when the command is queued.',
      'Commands that are really service objects with extra ceremony.',
      'Undo without idempotency leads to double application.',
    ],
    example: `class RefundPayment
  def initialize(payment_id:, amount_cents:)
    @payment_id = payment_id
    @amount_cents = amount_cents
  end

  def call
    payment = Payment.find(@payment_id)
    payment.refund!(@amount_cents)
  end

  def to_h = { payment_id: @payment_id, amount_cents: @amount_cents }
end

RefundJob.perform_later(RefundPayment.new(payment_id: 7, amount_cents: 500).to_h)`,
    related: ['service-object'],
    reference: guru('command'),
  },
  {
    id: 'observer',
    category: 'behavioral',
    name: 'Observer',
    summary: 'Notify interested parties without coupling to them',
    intent: 'Let an object announce that something happened while any number of other objects react, without the announcer knowing who they are.',
    whenToUse: [
      'One event (order paid) must trigger unrelated reactions (email, analytics, stock).',
      'You want to add a reaction without editing the code that raises the event.',
    ],
    watchOutFor: [
      'ActiveRecord callbacks used as hidden observers — ordering and failure behavior are surprising.',
      'Synchronous subscribers that slow or break the publisher; hand heavy work to jobs.',
      'Subscribers registered in initializers that only run in some environments.',
    ],
    example: `ActiveSupport::Notifications.subscribe('order.paid') do |*, payload|
  AnalyticsJob.perform_later(payload[:order_id])
end

ActiveSupport::Notifications.instrument('order.paid', order_id: order.id) do
  order.mark_paid!
end`,
    related: ['command'],
    reference: guru('observer'),
  },
  {
    id: 'state',
    category: 'behavioral',
    name: 'State',
    summary: 'Behavior that depends on a lifecycle status',
    intent: 'Model an object whose allowed actions change with its status as explicit states with explicit transitions, instead of scattered `if status ==` checks.',
    whenToUse: [
      'A model has a `status` column and several methods that branch on it.',
      'Some transitions must be forbidden (a shipped order cannot be edited).',
    ],
    watchOutFor: [
      'Transitions that skip validation by writing the column directly.',
      'Many states with few behaviors: an enum plus guard clauses is enough.',
      'Concurrent transitions; lock the row or use optimistic locking.',
    ],
    example: `class Order < ApplicationRecord
  enum :status, { pending: 0, paid: 1, shipped: 2 }

  TRANSITIONS = { pending: %i[paid], paid: %i[shipped] }.freeze

  def transition_to!(next_status)
    allowed = TRANSITIONS.fetch(status.to_sym, [])
    raise ArgumentError, "#{status} -> #{next_status}" unless allowed.include?(next_status.to_sym)

    with_lock { update!(status: next_status) }
  end
end`,
    related: ['strategy'],
    reference: guru('state'),
  },
  {
    id: 'template-method',
    category: 'behavioral',
    name: 'Template Method',
    summary: 'Fixed skeleton, customizable steps',
    intent: 'Define the order of steps in a base class and let subclasses fill in individual steps.',
    whenToUse: [
      'Several classes repeat the same sequence and differ in one or two steps (importers, exporters, report builders).',
      'Framework-style hooks (`before_action`, `perform`) are a natural fit.',
    ],
    watchOutFor: [
      'Deep inheritance trees; prefer composition when steps vary independently.',
      'Subclasses that must call `super` in the right place — make the hook explicit instead.',
      'Hooks without a default raise NotImplementedError with a clear message.',
    ],
    example: `class Importer
  def run(io)
    rows = parse(io)
    rows.each { |row| persist(normalize(row)) }
  end

  private

  def parse(_io)       = raise NotImplementedError, "#{self.class}#parse"
  def normalize(row)   = row
  def persist(_attrs)  = raise NotImplementedError, "#{self.class}#persist"
end`,
    related: ['strategy'],
    reference: guru('template-method'),
  },
  {
    id: 'chain-of-responsibility',
    category: 'behavioral',
    name: 'Chain of Responsibility',
    summary: 'Pass a request along handlers until one acts',
    intent: 'Arrange handlers in a sequence where each either handles the request or passes it on, so steps can be added, removed or reordered independently.',
    whenToUse: [
      'Request processing is a pipeline (Rack middleware, validation stages, fallback lookups).',
      'The first handler that can answer should win.',
    ],
    watchOutFor: [
      'Requests that fall off the end with no handler; define a default.',
      'Handlers with hidden ordering dependencies.',
      'A plain array of callables is often simpler than a linked chain.',
    ],
    example: `class Pipeline
  def initialize(*steps) = @steps = steps

  def call(input)
    @steps.reduce(input) do |acc, step|
      result = step.call(acc)
      return result if result.is_a?(Halt)

      result
    end
  end

  Halt = Struct.new(:reason)
end`,
    related: ['command'],
    reference: guru('chain-of-responsibility'),
  },
  {
    id: 'adapter',
    category: 'structural',
    name: 'Adapter',
    summary: 'Wrap a third-party API behind your interface',
    intent: 'Translate an external library or service into the interface your application wants, so the rest of the code never sees the vendor\'s shapes or errors.',
    whenToUse: [
      'You call a payment, email or storage provider from more than one place.',
      'You may swap vendors, or need a fake in tests.',
      'The vendor\'s errors and response formats should not leak into domain code.',
    ],
    watchOutFor: [
      'Adapters that expose the vendor\'s response objects; return your own types.',
      'Swallowing vendor errors; translate them to your own error classes.',
      'Putting retries and timeouts in callers instead of the adapter.',
    ],
    example: `class PaymentGateway
  class Error < StandardError; end

  def initialize(client: Stripe::Client.new)
    @client = client
  end

  def charge(cents:, token:)
    resp = @client.charges.create(amount: cents, source: token)
    resp.fetch(:id)
  rescue Stripe::StripeError => e
    raise Error, e.message
  end
end`,
    related: ['facade'],
    reference: guru('adapter'),
  },
  {
    id: 'facade',
    category: 'structural',
    name: 'Facade',
    summary: 'One simple entry point to a subsystem',
    intent: 'Offer a small, task-oriented interface over a cluster of classes, so callers do not need to know how they fit together.',
    whenToUse: [
      'A caller must instantiate and sequence three or more collaborators to do one thing.',
      'You want a stable boundary between modules of a monolith.',
    ],
    watchOutFor: [
      'A facade that grows into a god object; keep it a thin coordinator.',
      'Hiding too much: advanced callers may still need the underlying objects.',
    ],
    example: `class Checkout
  def self.complete(cart:, user:)
    order  = Orders::Place.call(cart: cart, user: user)
    Inventory::Reserve.call(order)
    Payments::Capture.call(order)
    order
  end
end`,
    related: ['adapter', 'service-object'],
    reference: guru('facade'),
  },
  {
    id: 'decorator',
    category: 'structural',
    name: 'Decorator / Presenter',
    summary: 'Presentation logic without polluting the model',
    intent: 'Wrap an object to add display-oriented behavior (formatting, labels, view helpers) while delegating everything else, keeping models free of presentation concerns.',
    whenToUse: [
      'A model gains methods that only views use (`full_name`, `status_badge`).',
      'The same record is shown differently in HTML, email and JSON.',
      'You use Draper, ViewComponent or a hand-rolled `SimpleDelegator`.',
    ],
    watchOutFor: [
      'Decorating inside the view layer for every row; build decorators once in the controller.',
      'Putting business rules in the decorator.',
      'Forgetting `object` access when a plain model is required (forms, `link_to`).',
    ],
    example: `class UserPresenter < SimpleDelegator
  def display_name
    name.presence || email.split('@').first
  end

  def member_since
    created_at.strftime('%B %Y')
  end
end

UserPresenter.new(user).display_name`,
    projectKind: 'decorator',
    related: ['value-object'],
    reference: guru('decorator'),
  },
  {
    id: 'factory-method',
    category: 'creational',
    name: 'Factory Method',
    summary: 'Let a subclass or lookup decide what to build',
    intent: 'Create objects through a method or registry rather than calling a concrete constructor, so the choice of class can vary without changing callers.',
    whenToUse: [
      'The class to instantiate depends on a type string or record column (STI, notifiers, parsers).',
      'Tests need to substitute the created object.',
    ],
    watchOutFor: [
      '`constantize` on user input; map allowed values explicitly.',
      'A registry that is only populated when files happen to load; require them explicitly.',
    ],
    example: `module Notifiers
  REGISTRY = { email: Email, sms: Sms, push: Push }.freeze

  def self.for(channel)
    REGISTRY.fetch(channel.to_sym) { raise ArgumentError, "unknown channel: #{channel}" }.new
  end
end

Notifiers.for(user.preferred_channel).deliver(message)`,
    related: ['builder', 'strategy'],
    reference: guru('factory-method'),
  },
  {
    id: 'builder',
    category: 'creational',
    name: 'Builder',
    summary: 'Construct complex objects step by step',
    intent: 'Separate assembling a complex object from its representation, so optional parts are added through readable calls and the final object is valid when built.',
    whenToUse: [
      'An object needs many optional parts (query filters, mail messages, API payloads, test data).',
      'Construction has rules (required fields, ordering) you want to enforce in one place.',
    ],
    watchOutFor: [
      'A builder that returns itself half-built; require an explicit `build` call.',
      'Keyword arguments are often enough for a handful of options.',
    ],
    example: `class ReportRequest
  Builder = Struct.new(:filters, :columns) do
    def initialize = super({}, [])
    def where(key, value) = tap { filters[key] = value }
    def column(name)      = tap { columns << name }
    def build
      raise ArgumentError, 'at least one column' if columns.empty?

      { filters: filters.freeze, columns: columns.freeze }
    end
  end
end

ReportRequest::Builder.new.where(:status, 'paid').column(:id).column(:total).build`,
    related: ['factory-method'],
    reference: guru('builder'),
  },
  {
    id: 'singleton',
    category: 'creational',
    name: 'Singleton (hazard)',
    summary: 'Global state — usually avoid in Rails',
    intent: 'Ensure a class has one instance with global access. In Rails this tends to create hidden shared state across requests and threads.',
    whenToUse: [
      'Rarely: genuinely process-wide, read-only configuration or a connection pool owned by a library.',
    ],
    watchOutFor: [
      'Mutable singletons and class-level instance variables are shared between threads in Puma and between requests.',
      'Singletons make tests order-dependent; inject the collaborator instead.',
      'Prefer `Rails.application.config`, dependency injection, or `Current` attributes for per-request data.',
    ],
    example: `# Prefer injection over a global:
class ReportJob
  def initialize(clock: Time)
    @clock = clock
  end

  def perform
    puts @clock.now
  end
end`,
    related: ['factory-method'],
    reference: guru('singleton'),
  },
]

export function getCatalogPattern(id: string): CatalogPattern | undefined {
  return PATTERN_CATALOG.find(p => p.id === id)
}

export function patternsInCategory(category: PatternCategory): CatalogPattern[] {
  return PATTERN_CATALOG.filter(p => p.category === category)
}

export interface ProjectInstance {
  name: string
  /** Workspace-relative POSIX path. */
  relativePath: string
  line: number
}

export function toProjectInstances(patterns: readonly IndexedPattern[], root: string): ProjectInstance[] {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '')
  return patterns
    .map(p => {
      const file = p.filePath.replace(/\\/g, '/')
      const rel = file.startsWith(`${normalizedRoot}/`) ? file.slice(normalizedRoot.length + 1) : file
      return { name: p.name, relativePath: rel, line: p.lineStart }
    })
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

/** Markdown shown in the editor for one pattern, with the project's own instances when known. */
export function renderPatternDoc(pattern: CatalogPattern, instances: readonly ProjectInstance[] | undefined): string {
  const related = (pattern.related ?? [])
    .map(id => getCatalogPattern(id))
    .filter((p): p is CatalogPattern => Boolean(p))
  const lines: string[] = [
    `# ${pattern.name}`,
    '',
    `_${CATEGORY_LABELS[pattern.category]}_`,
    '',
    pattern.intent,
    '',
    '## When to use it',
    '',
    ...pattern.whenToUse.map(t => `- ${t}`),
    '',
    '## Watch out for',
    '',
    ...pattern.watchOutFor.map(t => `- ${t}`),
    '',
    '## Example',
    '',
    '```ruby',
    pattern.example,
    '```',
    '',
  ]

  if (pattern.projectKind) {
    lines.push('## In this project', '')
    if (!instances || instances.length === 0) {
      lines.push(`_No ${pattern.projectKind} classes found (looked in \`${pattern.projectKind === 'policy' ? 'policies' : `${pattern.projectKind}s`}/\` under app/ and lib/)._`)
    } else {
      lines.push(...instances.map(i => `- \`${i.name}\` — ${i.relativePath}:${i.line}`))
    }
    lines.push('')
  }

  if (related.length > 0) {
    lines.push('## Related', '', ...related.map(r => `- ${r.name}`), '')
  }
  if (pattern.reference) {
    lines.push('## Reference', '', `- [${pattern.reference.label}](${pattern.reference.url})`, '')
  }
  return lines.join('\n')
}

/**
 * The prompt for "Explain pattern in chat". Built only from catalog text: no project files,
 * schema, routes or editor content are part of it.
 */
export function explainPatternPrompt(pattern: CatalogPattern): string {
  return [
    `Explain the "${pattern.name}" design pattern to a Ruby on Rails developer, using only the notes below.`,
    'Cover: what problem it solves, how the example works line by line, one situation where it is the wrong choice, and how to tell when a codebase needs it.',
    '',
    `Intent: ${pattern.intent}`,
    '',
    'When to use:',
    ...pattern.whenToUse.map(t => `- ${t}`),
    '',
    'Watch out for:',
    ...pattern.watchOutFor.map(t => `- ${t}`),
    '',
    'Example:',
    '```ruby',
    pattern.example,
    '```',
  ].join('\n')
}
