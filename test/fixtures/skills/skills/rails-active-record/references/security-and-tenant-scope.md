# Security and tenant scope

Reference for the `rails-active-record` skill. Load it on demand when a query crosses tenant, authorization, unscoped, raw SQL, or dynamic identifier boundaries. The operating rules, invariants, and verification steps stay in the skill's `SKILL.md`.

## Security and tenant scope

Active Record queries are not inherently authorized.

Review:

- tenant predicates
- authorization/policy boundary
- default_scope assumptions
- unscoped
- raw SQL
- dynamic column/order inputs
- IDs from external requests
- cross-tenant associations.

Do not use default_scope, model existence, or obscurity of an ID as an authorization mechanism.

Dynamic SQL identifiers require an explicit allowlist; values should remain parameterized.
