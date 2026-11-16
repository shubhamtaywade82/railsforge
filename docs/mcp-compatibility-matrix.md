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
| Standalone server read by **Nexum** (its MCP v2 client, adapter and trust policy) | Not specific to Nexum | Yes, as a manual acceptance: `scripts/acceptance/nexum-mcp.mjs --nexum <checkout>` | **Verified on Nexum's default branch**, `main` at `4eb83db` (PR #66 merged): 12 of 12 requirements pass. Before the merge, `010c709` failed three of them (9 of 12). See the Nexum section below | No |
| External MCP gateway: RailsForge as the **client** of external servers | Yes | Yes: `test/ExternalGatewayAcceptance.test.ts`, `test/ExternalCancellation.test.ts`, `test/ExternalGovernance.test.ts`, `test/ExternalSchemaCompatibility.test.ts` | Against the fixture server (`test/fixtures/mcp/echo-server.mjs`) only. The live third-party check (`ask-ruby-harness-mcp`) is blocked until it is authorized | No |
| Approval prompt (a Quick Pick) | Yes | Yes: unit tests with a fake Quick Pick, and `test-host/suite/approval.host.ts` | Not applicable | **Editor verified** in the Extension Host, on VS Code 1.146 and 1.96, driving the real Quick Pick with the editor's own keys. Not yet in an installed user session |
| Chat Stop control | Yes | Yes: `test/RailsChatViewProvider.test.ts`, `test/ChatStopEndToEnd.test.ts`, and the provider cancellation tests | Not applicable | No: the Stop button has not been clicked in a running window |
| Language-model tools inside VS Code (`railsforge_*`) | Yes | Yes: `test/LanguageModelTools.test.ts`, through the shared definitions | Not applicable | No |

## Structured results, hints and error codes (standalone server)

A tool that declares an output schema returns the same data twice: as text, unchanged from earlier versions, and as `structuredContent`. Clients validate `structuredContent` against the schema the server declares. A result that does not match its declaration is an error with code `OUTPUT_CONTRACT`, not a success.

Every native tool declares MCP hints derived from its risk: a static or cached read (R0, R1) is `readOnlyHint` and `idempotentHint`, and project code (R2) is `destructiveHint`.

A failed call is `isError: true`, its message is the text, and its stable code is in `_meta.railsforge.code`.

| Tool | Result | Structured (`structuredContent` key) |
| :--- | :--- | :--- |
| `list_routes` | List | `routes` |
| `list_patterns` | List | `patterns` |
| `list_skills` | Object | `source`, `count`, `skills` |
| `list_rake_tasks` | List | `tasks` |
| `find_similar_pattern` | List | `similar` |
| `get_example_file` | Object | `filePath`, `name`, `content` |
| `suggest_learning_resource` | Object | `book`, `chapter`, `note` |
| `get_dependencies`, `find_duplicate_methods` | Needs the persistent index | Not yet structured. Without the index: `INDEX_UNAVAILABLE` |
| `route_skills` | Needs the skills pack | Not yet structured. Without the pack: `SKILLS_UNAVAILABLE` |
| The other tools | Text | Not yet structured |

A lookup that finds nothing is `NOT_FOUND`, and a file that cannot be read is `UNREADABLE`. Before this batch those answers were successful text.

Codes emitted by the standalone server: `EXECUTION_DISABLED` (project code in an untrusted workspace), `APPROVAL_REQUIRED` (an R3 call with no approval), `INDEX_UNAVAILABLE`, `SKILLS_UNAVAILABLE`, `NOT_FOUND`, `UNREADABLE`, `OUTPUT_CONTRACT`, and `CANCELLED`. `TIMEOUT` is reserved for external servers.

**Cancellation.** A client that cancels a call stops the work. `list_rake_tasks` is the one native tool that runs a process, and the independent client (`test/McpCancellation.test.ts`) checks that the process stops at once, that the next candidate command does not start, that no process is left, and that the server still answers afterwards. The quality tools and the Ruby tools also run processes, and are not yet checked this way.

Two things come from the SDK, not from RailsForge. An unknown tool name, or arguments that fail the input schema, arrive as an error result whose text names the JSON-RPC code (`-32602`). A closed transport is a client-side failure that throws, so it can be told apart from a tool error.

## Known gaps

- Most native tools still return text only (21 of 28). Their structured forms need output schemas, and some need an index, a Ruby runtime or the network to verify.
- Cancellation is tested for `list_rake_tasks` only.
- The indexer's Ruby visibility is fixed for `initialize` and its copy hooks. Class-level `initialize` is kept, as a public singleton method.

## Nexum acceptance (manual)

`scripts/acceptance/nexum-mcp.mjs` imports Nexum's compiled MCP adapter and trust policy from a checkout's `dist/`, connects them to RailsForge's built server, and checks each requirement. The script never changes the Nexum checkout, so build Nexum first (`npx tsc -p tsconfig.json`).

Last run: RailsForge `26b4506` for the `010c709` and `30a7d9e` columns, and RailsForge `29880a6` for the `4eb83db` column. Each Nexum revision was compiled from its own clean checkout.

| Requirement | Nexum `010c709` (before the fix) | Nexum `30a7d9e` (fix branch) | Nexum `4eb83db` (`main`, after PR #66) |
| --- | --- | --- | --- |
| Nexum discovers RailsForge's declared tools, each with an object input schema | Pass (28 tools) | Pass (28 tools) | Pass (28 tools) |
| A call to `list_routes` returns its structured result to the agent | Pass | Pass | Pass |
| `INDEX_UNAVAILABLE` is preserved as a tool error, with its code | Pass (`_meta.railsforge.code`) | Pass (`_meta.railsforge.code`) | Pass (`_meta.railsforge.code`) |
| The reason for that error reaches the agent in the error message | **Fail**: N1 | Pass | Pass |
| An unapproved server is refused with the trust reason | Pass | Pass | Pass |
| An unapproved server is not started | **Fail**: N2 | Pass | Pass |
| An allow list offers exactly the tools it names | Pass | Pass | Pass |
| A risk ceiling denies tools above it | Pass | Pass | Pass |
| Project code does not run without RailsForge's grant, and the refusal names its code | Pass (`EXECUTION_DISABLED`) | Pass (`EXECUTION_DISABLED`) | Pass (`EXECUTION_DISABLED`) |
| An aborted call returns to the agent promptly, as cancelled | Pass | Pass | Pass |
| The server observes the cancellation, so its work stops | **Fail**: N3 | Pass | Pass |
| Closing the connection leaves no server process behind | Pass | Pass | Pass |
| **Result** | **9 of 12** | **12 of 12** | **12 of 12** |
| Informational: Nexum does not lower a tool's risk from the server's own hints | Pass (0 of 28 below `high`) | Pass (0 of 28 below `high`) | Pass (0 of 28 below `high`) |
| Informational: the SDK's own signal option reaches the server | Pass | Pass | Pass |

**Findings in Nexum.** All four are in Nexum, and none is compensated for in RailsForge. The fixes are source changes, merged into Nexum's `main` as `4eb83db` by `shubhamtaywade82/nexum#66`.

- **N1: the error message drops the server's reason.** Fixed in `4bcdf69`. `src/mcp/adapter/mcp-tool-adapter.ts` now builds the message from the server's text content and keeps `_meta`.
- **N2: a server is spawned before the trust decision.** Fixed in `7163478`. `connectMcpServerTools` decides on the fingerprint before it connects, so a denied or unapproved server runs no code and lists no tools. The fingerprint is unchanged, so existing approvals still match.
- **N3: cancellation never reaches the server.** Fixed in `4bcdf69` (the call's signal is carried) and `7163478` (the signal and timeout are passed to the SDK's `callTool`).
- **N4 (documentation): risk is not inferred from annotations.** Corrected in `30a7d9e`. The docs said risk is "inferred from MCP annotations", which the code never did, and the decision is to keep it that way: a server's own `readOnlyHint` must not lower a tool's risk. RailsForge declares those hints on its R0 and R1 tools, so the informational check confirms that nothing falls below `high`.

Configuration note: Nexum treats a listed server with no `trust` field as `trusted`. Use `"trust": "ask"` explicitly for RailsForge, as the acceptance does, and keep `tools.allow` narrow.
