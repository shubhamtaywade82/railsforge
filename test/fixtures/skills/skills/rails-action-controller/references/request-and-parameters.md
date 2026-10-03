# Request boundary, strong parameters, and request object semantics

Reference for the `rails-action-controller` skill. Load it on demand when a change reads request input, alters strong parameters or params.expect, or depends on request object semantics. The operating rules, invariants, and verification steps stay in the skill's `SKILL.md`.

## Request boundary

Treat every request value as untrusted input, including query parameters, body parameters, path parameters, headers, cookies, session-derived identifiers, format values, redirect targets, file names, and download options.

Translate these values into a narrow, explicit input contract before calling domain code.

Do not use request metadata as a substitute for authorization. A route, header, cookie, or parameter can identify context, but the owning authorization boundary decides whether an operation is permitted.

## Parameters and strong parameters

Use the repository's supported strong-parameter API.

For versions supporting params.expect, prefer it when the repository convention allows it because it can require and permit the expected structure in one boundary operation. Otherwise use require and permit deliberately.

Guidance:

- permit only fields the action is allowed to mutate or consume
- keep permitted shapes explicit
- treat nested arrays/hashes as deliberate contracts
- separate transport normalization from domain validation
- Do not use permit! merely to make an integration work
- do not permit fields just because the model has them
- avoid forwarding the entire params object into domain/persistence code
- test omitted, extra, malformed, and nested inputs.

Strong parameters are an input boundary, not an authorization system and not a substitute for domain validation.

## Request object semantics

Use the request object for HTTP facts, not domain state.

Review method, path, host, protocol, headers, query/body/path parameter separation, requested format, content type, and trusted proxy conventions.

Do not derive security-sensitive identity directly from forwarded headers without inspecting trusted proxy configuration and local conventions.
