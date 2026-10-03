# Loading strategy and performance

Reference for the `rails-active-record` skill. Load it on demand when a change alters eager/strict loading, N+1 behavior, batching, or query cost. The operating rules, invariants, and verification steps stay in the skill's `SKILL.md`.

## Loading strategy

Choose the smallest loading strategy that matches the access pattern.

Distinguish:

- lazy association access
- preload
- eager_load
- includes
- joins
- strict loading.

Use eager loading/preloading when a real access pattern would otherwise issue repeated queries. Do not preload the entire object graph just in case.

Use strict loading when the repository wants accidental lazy association access to fail or when an explicit N+1 contract is valuable. Treat strict loading failures as evidence to fix the query boundary rather than disable the check indiscriminately.

Coordinate measured N+1/query cost with rails-performance.

## Performance and capacity

Review query shape and object allocation separately.

Look for:

- accidental full-table loads
- unnecessary model instantiation
- N+1 association access
- repeated COUNT/EXISTS queries
- unbounded batch jobs
- large to_a
- excessive callback fan-out
- duplicate loads caused by mixed preload/join usage.

Use evidence from rails-performance and rails-database-engineering before claiming improvement.

For large datasets, prefer bounded batch APIs such as find_each/find_in_batches where their ordering and concurrency semantics fit the workload.
