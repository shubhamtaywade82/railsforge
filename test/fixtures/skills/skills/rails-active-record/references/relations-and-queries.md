# Relations, queries, scopes, and projections

Reference for the `rails-active-record` skill. Load it on demand when a change alters model ownership, Relation composition, query shape, scopes/default_scope, or projections. The operating rules, invariants, and verification steps stay in the skill's `SKILL.md`.

## Model boundary

Use an Active Record model when the object represents persisted relational state and Active Record behavior is an actual consumer contract.

Keep the model cohesive:

- attributes and persisted behavior
- local domain predicates
- query scopes with explicit semantics
- lifecycle behavior that truly belongs to the record
- validation hooks owned by rails-validations.

Do not turn models into service containers, API clients, mailers, job schedulers, or authorization engines.

When a workflow coordinates multiple records, external systems, or several steps, prefer an application/domain service and keep each model responsible for its own persisted invariants.

## Relation semantics

Treat ActiveRecord::Relation as a lazy query description until a terminal operation/materialization occurs.

Review whether code:

- chains relations or accidentally turns them into Arrays
- triggers SQL earlier than expected
- reuses a relation after mutation or scoping
- changes ordering or grouping implicitly
- introduces joins that alter cardinality
- uses distinct/group/having intentionally
- returns model instances when scalar or projection data is enough.

Common terminal/materializing operations include loading records, iteration in many contexts, to_a, pluck, pick, count, and other query execution methods. Verify exact behavior against the resolved Rails version.

Prefer a relation as an internal query contract when callers need further composition. Return materialized values only when that is the intended API.

## Query composition

Build queries from explicit relation operations.

Review:

- where
- select
- reorder/order
- joins
- left_joins
- merge
- distinct
- group
- having
- limit/offset
- exists?
- calculations
- pluck/pick
- batch iteration.

Avoid string SQL when a structured relation API expresses the contract safely and clearly. When raw SQL is necessary, keep values parameterized and make adapter/version assumptions explicit.

Do not use Ruby-side filtering or sorting for datasets that should be filtered or ordered by the database unless the data set is deliberately small and that tradeoff is documented by repository evidence.

## Scopes and default_scope

Use scopes for named, composable query semantics that are unsurprising to callers.

A good scope:

- returns a relation
- has predictable composition behavior
- does not perform external side effects
- does not hide expensive work unexpectedly
- has a name describing its semantic filter or order.

Be cautious with default_scope. It silently participates in many relations and can affect both reads and record creation. Use explicit scopes when visibility or lifecycle rules must be obvious.

When changing default_scope:

- inspect every call site that assumes implicit filtering
- inspect creation defaults
- inspect unscoped callers
- verify tenant/security semantics
- add regression coverage for both scoped and unscoped behavior.

Never use default_scope as an authorization mechanism.

## Projection and calculations

Avoid instantiating full Active Record objects when the caller only needs scalar data.

Use explicit projections such as pluck or pick when the contract is a scalar or array result.

Review the tradeoff:

- projected values do not carry model methods or callback behavior
- immediate materialization can prevent further relation composition
- custom attribute methods may not apply
- type casting must match the caller's expectations.

Never change a model query to pluck solely for perceived speed without verifying the consumer contract and measuring the workload when performance is material.
