# Routine model, migration, and query changes

Reference for the `rails-active-record` skill. Load it on demand when the change is a routine model, migration, scope, callback, or query edit. The operating rules, invariants, and verification steps stay in the skill's `SKILL.md`.

## Routine model, migration, and query changes

_Merged from the retired `rails-active-record` skill._

### Repository inspection

Always inspect:

- schema.rb/structure.sql
- relevant migrations
- model
- associations
- validations
- callbacks
- scopes
- existing queries
- factories/fixtures
- tests
- indexes/constraints where visible

Never infer database behavior from the model file alone.

### Migrations

A migration describes a schema transition.

Review:

- column type
- nullability
- defaults
- foreign keys
- indexes
- uniqueness
- reversibility
- existing-data impact
- table size/production safety

Do not assume a migration is safe merely because it runs on an empty development database.

### Models

A model can contain behavior that naturally belongs to the persisted/domain record.

Do not turn it into a universal service container.

### Validations versus constraints

Model validation provides application-level feedback.

Database constraints provide stronger integrity guarantees, especially under concurrent writes.

For important invariants, consider both.

### Queries

Watch for:

- N+1 queries
- accidental full-table loads
- Ruby-side filtering that belongs in SQL
- unnecessary joins
- duplicate rows
- ambiguous ordering
- missing indexes
- large `.to_a`/materialization
- repeated queries inside loops

Choose SQL versus Ruby based on data volume, correctness, and repository conventions.

### Scopes

Use scopes when they are named, composable, and unsurprising.

Avoid scopes that hide large side effects or return surprising query shapes.

### Callbacks

Callbacks can make persistence side effects implicit.

Before adding one, ask whether an explicit application/domain workflow is clearer.

If callbacks already exist, map their lifecycle before refactoring.

### Transactions

Use the repository's transaction conventions when multiple persistence changes must succeed or fail together.

Do not assume external API calls participate in database transactions.

### Reference example

The routine path: a model with association and validation, SQL-side filtering, and a reversible migration with an index.

```ruby
class Invoice < ApplicationRecord
  belongs_to :customer, counter_cache: true
  has_many :line_items, dependent: :destroy

  validates :reference, presence: true, uniqueness: true
end

# Filter and order in SQL; Ruby-side filtering only for tiny, in-memory sets.
customer.invoices.where(paid: false).order(:due_on).limit(10)

class AddReferenceToInvoices < ActiveRecord::Migration[8.0]
  def change
    add_column :invoices, :reference, :string, null: false, default: ""
    add_index :invoices, :reference, unique: true
  end
end
```

### Agent review checklist

- [ ] schema inspected
- [ ] migration impact considered
- [ ] database constraints evaluated
- [ ] query plan/performance considered where material
- [ ] N+1 risk checked
- [ ] callback side effects mapped
- [ ] transaction boundary correct
- [ ] tests cover persistence behavior

### Verification

Run migration/schema checks and model/query tests. For performance-sensitive changes, inspect generated SQL/query counts and use the repository's profiling tools where available.
