# External MCP servers

RailsForge can let its own agent use tools from other MCP servers. You list the servers in your **user** settings. RailsForge starts each one, lists its tools, and offers the tools you allow. This is separate from the optional tools in [optional-tools.md](optional-tools.md), which are installed and detected by RailsForge. Here you name any server and its command yourself.

## Status

What has been verified, and what has not:

- **Verified with real processes.** A stdio server started through the MCP SDK client, with the project root as its working directory. Its tools are listed and called, its errors are reported, and its exit is handled (`test/ExternalMcpStdio.test.ts`).
- **Verified through the gateway.** RailsForge's agent discovers an external tool and calls it. An R3 call runs only with approval for that call. Denied and malformed calls never reach the server. Cancelling an operation stops the running tool and its process. The chat's Stop button, pressed while an external tool runs, is tested end to end with the real view, agent and server process (`test/ChatStopEndToEnd.test.ts`). A crash ends one tool and not the loop. The approval, audit and cancellation claims are checked against the server's own record (`test/ExternalGatewayAcceptance.test.ts`, `test/ExternalCancellation.test.ts`). A static test keeps every external call on this path (`test/GatewayBoundary.test.ts`).
- **Verified in VS Code.** The configuration rules and the editor path, on VS Code 1.146 and 1.96 (`test-host/suite/editor.host.ts`).
- **Not yet verified.** A real third-party server, such as `ask-ruby-harness-mcp`. Run the opt-in live check (see below) before relying on one. Also not verified: that Cursor, Claude Code or Copilot connect to RailsForge and call its tools, and that a debugger can be attached and controlled through `debug-mcp`. The chat's Stop button and the approval prompt are tested against a mocked VS Code API, not clicked in a running editor.

`.cursor/mcp.json` is not read by RailsForge. Adding a server there makes it available to Cursor, not to RailsForge's agent. Use `railsForge.mcp.servers` for RailsForge's agent.

## Configuration

Add entries to `railsForge.mcp.servers` in your user `settings.json`:

```json
"railsForge.mcp.servers": [
  {
    "id": "my-tools",
    "command": "/absolute/path/to/my-mcp-server",
    "args": ["--stdio"],
    "env": { "MY_TOOLS_MODE": "read-only" },
    "allowTools": ["get_schema"]
  }
]
```

| Field | Required | Meaning |
| :--- | :--- | :--- |
| `id` | yes | Lowercase letters, digits and hyphens, starting with a letter, up to 32 characters. The agent sees tools as `<id>__<tool>`. |
| `command` | yes | The executable to start. It is run directly, not through a shell. Use the full path to a global tool. |
| `args` | no | Arguments for the command. |
| `env` | no | Extra environment variables for the process. Values are stored in plain text. |
| `allowTools` | no | The tool names the agent may call. **Nothing is offered unless it is listed here.** |
| `toolRisk` | no | The risk of an allowed tool: `"R2"` runs without a prompt in a trusted workspace; `"R3"` asks you before every call. A tool not listed is `R3`. The name must be in `allowTools`. `R4` is never accepted. |
| `enabled` | no | `false` keeps the entry without starting the server. The default is `true`. |
| `transport` | no | Only `"stdio"` is supported. |
| `exposeToEditor` | no | `true` also offers the server to the editor's own agent (Copilot, Cursor). The default is `false`. See below. |

An entry with any problem is left out and reported in the test command. An unknown key is a problem, so a typo in `allowTools` cannot silently expose nothing.

## Rules

- **User settings only.** The setting has application scope, and RailsForge reads the user value only. A repository's `.vscode/settings.json` cannot start a process through it.
- **Default deny.** A server's tools are offered only when named in `allowTools`. The server's own hints, such as `readOnlyHint`, grant nothing.
- **Approval for each risky call.** An allowed tool is `R3` unless you declare it `R2`, so each call asks you first. The prompt shows the tool, the workspace, the operation and the arguments. Only "Allow once" runs the call, and the next call asks again. If you stop the request while the prompt is open, the prompt stays on screen until you answer it; the call is denied either way.
- **Strict arguments.** Arguments are checked against the server's schema before anything runs. A schema using a keyword the validator cannot enforce (such as `$ref`, `oneOf`, `anyOf`, `allOf` or `format`) makes the tool unavailable, with the reason, rather than being checked more loosely. Python servers built on pydantic often declare an optional field as `anyOf` with `null`, so a tool with such a field is unavailable in this version. Nullable types written as `"type": ["string", "null"]`, enums, nested objects, bounds, and the `$schema`, `title`, `description` and `default` annotations are supported.
- **Cancellation.** Stopping a request (the chat's Stop button, or cancelling an operation) ends the model request, sends the MCP cancellation to the server, and ends the tool call. If that was the only call on the process, the process is stopped too. A stopped process is shown as `stopped` and starts again on the next call; the status report does not start it. A timeout stops the process and holds it back for 30 seconds, because its state is unknown.
- **Failures carry codes.** The agent sees a failed tool as a step with its code (for example `APPROVAL_DENIED`, `TIMEOUT` or `SERVER_EXITED`), not only as text.
- **Trusted workspaces only.** In a Restricted Mode workspace nothing starts, and no external tool is offered to the agent.
- **Project root.** Each server starts with the project root as its working directory. In a multi-root workspace, each project gets its own process.
- **Started on demand.** A server starts the first time the agent may use one, not at activation. A server that fails or exits is not retried for 30 seconds. Connecting and listing time out after 15 seconds; a single call times out after 60 seconds.
- **Clean environment.** The process gets the usual system variables plus only your `env` values, not the extension host's full environment.
- **Audited.** Every call RailsForge's own agent makes is written to `.railsforge/mcp/audit.jsonl` with the tool name, its risk, whether it was approved, and the **argument names**, never the values. The editor path below is not audited by RailsForge.
- **Output.** Only text content reaches the agent. Images and other content are named as omitted. Long results are clipped as the agent's other tools are.

## Example: ask-ruby-harness-mcp

The gem's own README (version 0.2.1) describes a stdio server started with no arguments and served from the project's working directory. That is the shape the configuration above uses:

```json
"railsForge.mcp.servers": [
  {
    "id": "ask-ruby",
    "command": "ask-ruby-harness-mcp",
    "allowTools": ["read_model", "schema_graph", "read_log"]
  }
]
```

The server provides six tools. Offer only the ones you need:

| Tool | Notes |
| :--- | :--- |
| `read_model`, `schema_graph`, `read_log` | Read-only. A sensible default. |
| `run_tests` | Runs the project's test suite, so it is refused in an untrusted workspace. |
| `query_database` | Reads your database. Use a read-only connection, and never a production one. |
| `run_command` | Runs arbitrary shell commands. Do not offer it. |

This example comes from the README. It has not been run from RailsForge in this build. To check it in your environment, run the live test in the next section, or use **RailsForge: Test External MCP Servers**.

## Live check (opt-in)

`test/ExternalMcpLive.test.ts` starts a real server and checks that it reaches `ready` in the project root, that it provides the tools you allow, and that `run_command` is not offered. It is skipped unless `RAILSFORGE_LIVE_MCP_COMMAND` is set, so CI never installs or starts third-party code:

```bash
RAILSFORGE_LIVE_MCP_COMMAND=ask-ruby-harness-mcp \
RAILSFORGE_LIVE_MCP_ROOT=/path/to/a/ruby/project \
RAILSFORGE_LIVE_MCP_ALLOW=read_model,schema_graph,read_log \
npx vitest run test/ExternalMcpLive.test.ts
```

## Offering a server to the editor's agent

Set `"exposeToEditor": true` to also offer a server to the editor's own agent (Copilot, Cursor). The editor then starts the server itself, in each project folder, and lists its tools in its own tool picker.

This path has different guarantees, and you should accept them knowingly:

- **`allowTools` does not apply.** The editor cannot be told which tools to hide, so every tool the server provides reaches the editor's agent.
- **RailsForge does not audit it.** The editor's own approval and logging apply instead. RailsForge's audit trail covers only its own agent.
- **Trusted workspaces only.** Nothing is offered in a Restricted Mode workspace.
- **User settings only**, as for RailsForge's own agent. A repository cannot offer a server to the editor through its settings.
- **Needs VS Code 1.105 or later.** Earlier versions cannot set a server's working directory, so RailsForge offers none of its servers to the editor there, and logs the reason. The version gate was checked against VS Code's shipped bundles. The extension API cannot ask a host at runtime whether it honours the directory.

A server can be offered both ways. Then two processes run for it: one for RailsForge's own agent and one started by the editor.

## Checking a server

Run **RailsForge: Test External MCP Servers**. It opens a report with each server's state, the tools it offers, and any configuration problems. Use it to choose names for `allowTools`. Each server is `starting`, `running`, `stopping`, `stopped` or `failed`, or `disabled` or `untrusted` when its configuration or the workspace keeps it from starting. A failed server is not retried for 30 seconds, and the report gives its reason.

## Not in this version

- HTTP servers, and OAuth. Remote services such as Sentry and GitHub need these.
- Secret storage. `env` values are plain text in your settings file, so keep secrets out of it until secret storage is added.
