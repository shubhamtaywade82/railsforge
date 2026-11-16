# MCP compatibility matrix

Each integration is recorded at four levels, and a level is claimed only with the evidence named in its row:

- **Implemented**: the code exists.
- **Automated**: a repeatable test in the repository covers it.
- **Interoperability verified**: an independent client or server, outside RailsForge's own code, was used against it.
- **Production verified**: it was used in an installed, supported editor or deployment, in a real workflow.

A row can be verified at one level and not at the next. Passing at one level does not mark another client supported.

Last run: 2026-11-16 (branch `ccr-e6365557-nfj29y`, Claude Code 2.1.325, VS Code 1.146 and 1.96).

## Integrations

| Integration | Implemented | Automated | Interoperability verified | Production verified |
| :--- | :--- | :--- | :--- | :--- |
| Standalone server, stdio, read by an independent **MCP SDK** client | Yes | Yes: `test/McpInterop.test.ts` builds the bundle, runs the client in its own process, and checks initialize, `tools/list`, structured results, error codes and clean shutdown | Yes, on the Rails fixture | No |
| Standalone server, stdio, read by **Claude Code 2.1.325** | Yes | Manual: `scripts/acceptance/claude-code-mcp.mjs` (needs a signed-in Claude Code and a model call) | Yes, run 2026-11-16: the session discovered and called `list_routes`, answered from its result, and got the error results for an unbuilt index and an untrusted project-code call | No |
| Standalone server read by **Cursor** | Not specific to Cursor (the server is a generic stdio server) | No | **Not run**: Cursor is not installed in this environment | No |
| Standalone server read by **GitHub Copilot** | Not specific to Copilot | No | **Not run**: Copilot is not installed in this environment | No |
| Standalone server read by **Nexum** (its MCP v2 client, adapter and trust policy) | Not specific to Nexum | Yes, as a manual acceptance: `scripts/acceptance/nexum-mcp.mjs --nexum <checkout>` | **Partly verified**: 9 of 12 requirements pass against Nexum `010c709` (see the findings below). Three fail, and they are defects in Nexum | No |
| External MCP gateway: RailsForge as the **client** of external servers | Yes | Yes: `test/ExternalGatewayAcceptance.test.ts`, `test/ExternalCancellation.test.ts`, `test/ExternalGovernance.test.ts`, `test/ExternalSchemaCompatibility.test.ts` | Against the fixture server (`test/fixtures/mcp/echo-server.mjs`) only. The live third-party check (`ask-ruby-harness-mcp`) is blocked until it is authorized | No |
| Approval prompt (a Quick Pick) | Yes | Yes: unit tests with a fake Quick Pick, and `test-host/suite/approval.host.ts` | Not applicable | **Editor verified** in the Extension Host, on VS Code 1.146 and 1.96, driving the real Quick Pick with the editor's own keys. Not yet in an installed user session |
| Chat Stop control | Yes | Yes: `test/RailsChatViewProvider.test.ts`, `test/ChatStopEndToEnd.test.ts`, and the provider cancellation tests | Not applicable | No: the Stop button has not been clicked in a running window |
| Language-model tools inside VS Code (`railsforge_*`) | Yes | Yes: `test/LanguageModelTools.test.ts`, through the shared definitions | Not applicable | No |

## Structured results and error codes (standalone server)

A tool that declares an output schema returns the same data twice: as text, unchanged from earlier versions, and as `structuredContent`. Clients validate `structuredContent` against the schema the server declares. A result that does not match its declaration is an error with code `OUTPUT_CONTRACT`, not a success.

A failed call is `isError: true`, its message is the text, and its stable code is in `_meta.railsforge.code`.

| Tool | Result | Structured (`structuredContent` key) |
| :--- | :--- | :--- |
| `list_routes` | List | `routes` |
| `list_patterns` | List | `patterns` |
| `list_skills` | Object | `source`, `count`, `skills` |
| `list_rake_tasks` | List | `tasks` |
| `get_dependencies`, `find_duplicate_methods` | Needs the persistent index | Not yet structured. Without the index: `INDEX_UNAVAILABLE` |
| `list_skills`, `route_skills` | Needs the skills pack | Without the pack: `SKILLS_UNAVAILABLE` |
| The other tools | Text | Not yet structured |

Codes emitted by the standalone server: `EXECUTION_DISABLED` (project code in an untrusted workspace), `APPROVAL_REQUIRED` (an R3 call with no approval), `INDEX_UNAVAILABLE`, `SKILLS_UNAVAILABLE`, `OUTPUT_CONTRACT`, `CANCELLED`, and `TIMEOUT`, which external servers use.

Two things come from the SDK, not from RailsForge. An unknown tool name, or arguments that fail the input schema, arrive as an error result whose text names the JSON-RPC code (`-32602`). A closed transport is a client-side failure that throws, so it can be told apart from a tool error.

## Nexum acceptance (manual)

`scripts/acceptance/nexum-mcp.mjs` imports Nexum's compiled MCP adapter and trust policy, connects them to RailsForge's built server, and checks each requirement. Last run: RailsForge `430abe0`, Nexum `010c709` (unmodified). The script never changes the Nexum checkout.

| Requirement | Result |
| :--- | :--- |
| Nexum discovers RailsForge's declared tools, each with an object input schema | Pass (28 tools) |
| A call to `list_routes` returns its structured result to the agent | Pass |
| `INDEX_UNAVAILABLE` is preserved as a tool error, with its code | Pass (`_meta.railsforge.code`) |
| The reason for that error reaches the agent in the error message | **Fail**: finding N1 |
| An unapproved server is refused with the trust reason | Pass |
| An unapproved server is not started | **Fail**: finding N2 |
| An allow list offers exactly the tools it names | Pass |
| A risk ceiling denies tools above it | Pass |
| Project code does not run without RailsForge's grant, and the refusal names its code | Pass (`EXECUTION_DISABLED`) |
| An aborted call returns to the agent promptly, as cancelled | Pass |
| The server observes the cancellation, so its work stops | **Fail**: finding N3 |
| Closing the connection leaves no server process behind | Pass |

**Findings in Nexum** (reported to its owner; not changed here, since this session has read access only):

- **N1: the error message drops the server's reason.** `src/mcp/adapter/mcp-tool-adapter.ts`, in `call()`, builds `message` from `res.message ?? res.error`, which is absent on an MCP result. The server's text, in `content`, never reaches `message`, so the agent sees `MCP Tool Error. Expected Schema: …`. Taking the message from `res.content` fixes it.
- **N2: a server is spawned before the trust decision.** `src/mcp/adapter/mcp-server-tools.ts`, in `connectMcpServerTools`, connects the server and lists its tools before `opts.trust.decideServer`. A denied server has already run, and its tools have been listed. The fingerprint depends only on the command and arguments, so the decision can be made first.
- **N3: cancellation never reaches the server.** The adapter builds its request without the call's `signal`, and the wrapper calls `connection.client.callTool(params)` without options. The v2 client accepts `{ signal }` (`RequestOptions.signal`), and with that option the server observes the cancellation (informational check, passing).
- **N4 (documentation): risk is not inferred from annotations.** `docs/guide/mcp.md` says the risk is "inferred from MCP annotations". `src/mcp/adapter/security-metadata.ts` ignores the descriptor, so every tool is `high` unless overridden. The comment on `registerMcpTools` repeats the claim. RailsForge also declares no annotations, so it currently offers nothing to infer from. Declaring a read-only hint on the R0 and R1 tools is a RailsForge change for a later batch.

With the three code changes for N1, N2 and N3 applied to Nexum's compiled output, all 12 requirements pass. That was an experiment on a local build, and it was reverted.

Configuration note: Nexum treats a listed server with no `trust` field as `trusted`. Use `"trust": "ask"` explicitly for RailsForge, as the acceptance does, and keep `tools.allow` narrow.

## Known gaps

- Most native tools still return text only. Their structured forms need output schemas, and some need an index, a Ruby runtime or the network to verify.
- `initialize` appears among a service's `publicMethods`. Ruby makes `initialize` private, so the indexer is wrong here. This is recorded, not fixed.
- Cancellation of a long native call is wired through the signal, but no native tool in the fixture runs long enough to test it end to end.
