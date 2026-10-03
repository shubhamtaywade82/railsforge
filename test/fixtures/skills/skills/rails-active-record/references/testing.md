# Testing Active Record contracts

Reference for the `rails-active-record` skill. Load it on demand when choosing or writing tests for Active Record behavior. The operating rules, invariants, and verification steps stay in the skill's `SKILL.md`.

## Testing

Choose tests that prove the Active Record contract:

- model lifecycle tests for callbacks/persistence semantics
- query tests for relation composition
- request/integration tests where controller behavior depends on query semantics
- integration tests for tenant/security boundaries
- query-count/performance tests when the repository already uses them.

For lifecycle changes, test both successful and failing paths.

For bulk operations, test which validations/callbacks are intentionally absent or present.

For strict loading, test that unintended lazy loading fails where that is the contract.
