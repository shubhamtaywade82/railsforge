# Bulk writes and deletion semantics

Reference for the `rails-active-record` skill. Load it on demand when a change uses update_all, delete_all, destroy_all, insert/upsert, or alters deletion behavior. The operating rules, invariants, and verification steps stay in the skill's `SKILL.md`.

## Bulk writes and deletes

Distinguish object lifecycle methods from direct bulk operations.

Before using update_all, delete_all, destroy_all, import/upsert helpers, or adapter-specific bulk SQL, determine:

- validations
- callbacks
- timestamps
- dirty tracking
- association/dependent behavior
- returned values
- database constraint behavior
- audit/event semantics.

A bulk operation is not automatically equivalent to iterating through model instances.

Never replace destroy_all with delete_all just for speed without reviewing lifecycle, dependency, and audit contracts.

## Deletion semantics

Understand the difference between deleting a row and destroying a record through Active Record lifecycle.

Before changing deletion behavior inspect:

- dependent associations
- destroy callbacks
- soft-delete conventions
- database cascades
- auditing/events
- attachment cleanup
- authorization.

Keep irreversible side effects outside the model when their orchestration is broader than one record's lifecycle.
