# Sessions, cookies, flash, controller callbacks, exceptions, and security

Reference for the `rails-action-controller` skill. Load it on demand when a change alters session/cookie/flash state, controller callbacks, rescue_from/exception mapping, or request security. The operating rules, invariants, and verification steps stay in the skill's `SKILL.md`.

## Sessions, cookies, and flash

Treat session, cookie, and flash state as HTTP state with explicit lifecycle and privacy contracts.

Inspect the session store, cookie serializer, signed versus encrypted cookies, size limits, expiration/rotation behavior, authentication integration, and flash semantics.

Store the smallest state necessary. Do not put Active Record objects, secrets, authorization decisions, large collections, or sensitive provider responses into client-side cookie-backed state.

Signed cookies provide integrity protection; encrypted cookies add confidentiality. Neither means arbitrary application data should be stored there without an ownership and retention contract.

Do not infer authorization from the presence of a session value. Load and authorize the authoritative resource through the application's authentication/authorization boundary.

## Controller callbacks

Use callbacks for small, deterministic, cross-cutting request prerequisites such as authentication gating and resource loading.

For each callback verify affected actions, execution order, inherited callbacks, halting behavior, response state, and hidden database/network work.

Avoid callbacks that hide business workflows, external side effects, transactions, or large orchestration graphs.

When action order matters, make lifecycle assumptions explicit and test the affected action set.

## Exception handling

Use controller-level exception mapping only for errors with an explicit HTTP contract.

A good rescue_from boundary:

- identifies the expected exception class
- maps it to a stable response
- preserves status/content-type semantics
- emits appropriate observability context
- does not hide programmer defects.

Do not catch StandardError broadly to turn unexpected failures into successful-looking responses.

Keep authentication/authorization failures distinct from not-found, domain conflicts, validation errors, and dependency failures.

Coordinate error reporting with rails-observability; do not duplicate global error reporting inside one controller.

## Security and privacy

Compose rather than duplicate rails-security and rails-security-engineering.

Controller-specific checks include strong parameter boundaries, authorization before sensitive lookup/use, open-redirect prevention, cookie/session sensitivity, CSRF behavior for browser sessions, response content-type correctness, download authorization, error-detail exposure, filtered logging, host/proxy trust, and tenant isolation.

Never log raw authorization headers, session contents, password/reset fields, or full request bodies containing secrets.
