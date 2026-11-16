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
| Standalone server read by **Nexum** | Not specific to Nexum | No | **Not run**: no Nexum client is available here, and nothing in the repository describes its MCP client | No |
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

## Known gaps

- Most native tools still return text only. Their structured forms need output schemas, and some need an index, a Ruby runtime or the network to verify.
- `initialize` appears among a service's `publicMethods`. Ruby makes `initialize` private, so the indexer is wrong here. This is recorded, not fixed.
- Cancellation of a long native call is wired through the signal, but no native tool in the fixture runs long enough to test it end to end.
