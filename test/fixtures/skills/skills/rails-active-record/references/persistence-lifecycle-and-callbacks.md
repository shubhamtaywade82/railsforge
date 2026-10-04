# Persistence lifecycle, callbacks, dirty state, and transactions

Reference for the `rails-active-record` skill. Load it on demand when a change alters save/update/destroy semantics, callbacks, dirty tracking, or transaction participation. The operating rules, invariants, and verification steps stay in the skill's `SKILL.md`.

## Persistence lifecycle

Understand the distinction among:

- new in-memory record
- valid record
- persisted record
- saved record
- updated record
- destroyed record
- deleted row.

Before changing a write path, inspect which callbacks and validations execute and which direct methods intentionally bypass them.

Methods such as save, update, destroy, direct SQL updates/deletes, and bulk methods do not all provide the same lifecycle semantics.

Do not assume an in-memory object proves database state after a concurrent or independent write.

## Callbacks

Use Active Record callbacks only for lifecycle behavior intrinsically owned by the persisted record.

Good candidates can include small, deterministic normalization or lifecycle bookkeeping already consistent with repository conventions.

External side effects require particular care:

- prefer after_commit or after_rollback when the effect depends on transaction outcome
- understand that after_commit runs after persistence and cannot roll the transaction back
- preserve durable identity if the external operation can be retried
- avoid hidden network calls and large workflows in save callbacks.

Do not use callbacks to hide:

- multi-record application workflows
- authorization decisions
- unrelated integrations
- request-specific behavior
- job orchestration that belongs to an application boundary.

## Dirty and persistence state

Do not confuse attribute change tracking with persistence success.

When a feature depends on what changed, verify:

- when the change is observed
- whether the value was saved
- which callback phase runs
- whether a reload or fresh query is required
- whether another process can change the row independently.

Coordinate attribute/dirty protocol with Active Model and database transaction behavior with rails-database-engineering.

## Transactions and consistency

This skill reasons about Active Record transaction participation and lifecycle; rails-database-engineering owns deep transaction, locking, and isolation engineering.

When a write spans several Active Record calls, verify:

- which transaction owns them
- which callbacks fire before/after commit
- what external effects occur before or after commit
- whether retry can duplicate side effects
- whether failure leaves in-memory objects misleadingly changed.

Do not claim atomicity from a chain of model calls unless the actual transaction boundary proves it.
