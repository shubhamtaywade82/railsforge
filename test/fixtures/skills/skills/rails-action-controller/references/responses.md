# Response contract, render/redirect, content negotiation, conditional GET, and streaming

Reference for the `rails-action-controller` skill. Load it on demand when a change alters status codes, render/redirect behavior, formats, ETag/Last-Modified, or file/streaming responses. The operating rules, invariants, and verification steps stay in the skill's `SKILL.md`.

## Response contract

Every controller action should have an intentional response contract.

Review:

- status
- response format/content type
- body/render target
- redirect location
- headers
- caching validators
- empty-body semantics
- error representation
- content negotiation behavior.

Avoid accidental implicit rendering when the action requires a stable API or download contract. Conversely, do not add explicit render calls merely to restate normal Rails behavior when the repository relies on implicit rendering.

A redirect is a response; code after redirect_to can still execute. Return immediately when continuing could cause side effects or a second response.

Never create two response paths that can both render or redirect.

## Render and redirect semantics

For render:

- preserve repository view/serializer conventions
- verify status and content type for non-default responses
- keep representation decisions separate from domain logic
- distinguish rendering an error page from raising an exception.

For redirect:

- use stable route helpers or records when possible
- treat user-provided redirect targets as untrusted
- preserve Rails open-redirect protections
- use an explicit safe fallback for return-to flows
- choose redirect status deliberately for non-GET requests
- stop execution when redirect is terminal.

Do not enable cross-host redirects for untrusted input merely to preserve convenience behavior.

## Content negotiation

Treat request format and content negotiation as part of the public HTTP contract.

Define supported formats explicitly. Verify route constraints, requested format, Accept behavior, request content type, HTML fallback, API error format, and unsupported-format behavior.

Do not silently add formats because a serializer or helper exists.

Keep API wire contracts composed through rails-api-integration; this skill owns controller-level negotiation and response dispatch.

## Conditional GET and HTTP cache validators

Use conditional responses when a resource can provide a stable representation and validators.

Review ETag strength/semantics, Last-Modified, Cache-Control, private/public cache scope, and whether the representation varies by identity, permission, locale, tenant, or other request context.

A 304 Not Modified response is a transport optimization, not proof that application state is unchanged forever.

Do not derive a shared public cache validator from private data without including all relevant identity dimensions. Coordinate representation cache correctness with rails-caching.

## Streaming and downloads

Use file/download or streaming helpers only when their lifecycle and resource costs are understood.

Inspect file ownership/authorization, content type, content disposition, file size, buffering versus streaming, client disconnect behavior, resource cleanup, timeouts, and concurrency impact.

Do not stream an unbounded database query, external provider, or object graph directly from a controller without a bounded producer and cleanup design.

For Active Storage objects, compose with rails-active-storage rather than duplicating storage access rules.
