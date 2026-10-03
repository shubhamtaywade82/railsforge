# Controller performance and testing

Reference for the `rails-action-controller` skill. Load it on demand when a change has request-path performance impact or needs controller/request tests. The operating rules, invariants, and verification steps stay in the skill's `SKILL.md`.

## Performance and capacity

Controllers are part of the request concurrency budget.

Review synchronous database work, synchronous external calls, serialization size, response buffering, streaming connection duration, callback fan-out, cache validation work, and repeated authorization/lookups.

Long-lived streaming responses consume concurrency and must be included in capacity planning.

Do not call an endpoint fast based on controller line count. Use measured request/query/allocation/network evidence from rails-performance, ruby-performance, and rails-observability.

## Testing

Choose the narrowest test that proves the HTTP contract, then add focused integration coverage where lifecycle interactions matter.

At minimum, test relevant:

- permitted and rejected input
- missing/extra/nested parameters
- authenticated versus unauthenticated requests
- authorized versus forbidden requests
- success status/body/format
- redirect target and status
- session/cookie/flash behavior
- callback scope
- unsupported formats
- conditional response behavior
- exception-to-response mapping
- download authorization and headers
- streaming lifecycle when used.

Use deterministic local doubles for external providers and storage.
