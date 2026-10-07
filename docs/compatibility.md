# Compatibility

What RailsForge supports, what is tested, and what degrades. A test (`test/Compatibility.test.ts`) keeps the
tables below consistent with `package.json`, the shipped native binaries and the CI matrix, so they cannot drift silently.
Run **RailsForge: Diagnose Environment** to see how your own machine measures up.

## Editor

| Requirement | Value |
| --- | --- |
| VS Code | `^1.96.0` (engines floor) — tested on 1.96.0 (Linux) and the latest stable (Linux, Windows, macOS) |
| Cursor / VSCodium / other forks | Not tested; the extension only uses stable VS Code APIs, so they should work when built on VS Code ≥ 1.96 |
| Remote (SSH, WSL, Dev Containers) | Native modules load on the remote host, so the **remote** OS/arch must be in the table below |
| Workspace Trust | Runs in untrusted workspaces in a read-only mode (nothing executes project code) |

## Platforms

"Core" = everything except the AST index (schema, routes, navigation, graph, AI, tools). "AST index" = the SQLite + tree-sitter
index behind *Find Duplicate Methods* and *Show Dependency Cycles*; it needs prebuilt binaries for **all** of `better-sqlite3`,
`tree-sitter` and `tree-sitter-ruby`, N-API ≥ 10 (Node ≥ 22.14 inside VS Code) and, on Linux, glibc ≥ 2.33.

| Platform | Core | AST index | CI |
| --- | --- | --- | --- |
| `linux-x64` | ✅ | ✅ | `ubuntu-latest` (Node 20 + 22, host tests, installed-VSIX smoke test) |
| `win32-x64` | ✅ | ✅ | `windows-latest` (full matrix job) |
| `darwin-arm64` | ✅ | ✅ | `macos-latest` (full matrix job) |
| `darwin-x64` | ✅ | ✅ | `macos-15-intel` (full matrix job) |
| `linux-arm64` | ✅ | ❌ no `tree-sitter` prebuild | not tested |
| `win32-arm64` | ✅ | ❌ no `tree-sitter` prebuild | not tested |

On a platform or runtime where the AST index is unavailable, RailsForge says why once (and in the Architecture view) and
keeps every other feature running.

## Node (development and CI)

Extension code runs on VS Code's bundled Node. For building and testing the repository, Node 20.x and 22.x are exercised in CI;
`@vscode/test-electron` and `better-sqlite3` themselves require Node ≥ 22, so use 22 for host tests (`pnpm run test:host`).

## Ruby projects

RailsForge bundles no Ruby. It reads versions from the project (`.ruby-version`, `.tool-versions`, `Gemfile`, `Gemfile.lock`) and
never invents one; an undeclared version is reported as `unknown`.

| Area | Supported |
| --- | --- |
| Project tool launcher | `bin/` stub → `bundle exec` → bare tool, wrapped in the detected version manager |
| Version managers | mise, asdf, rbenv, rvm, chruby |
| Test frameworks | RSpec, Minitest (Test Explorer + CodeLens + debug via `rdbg`) |
| Linters / analyzers (optional, run when installed) | RuboCop, Brakeman, bundler-audit, Reek, Flog, Flay, Debride, Standard, Steep/RBS |
| Ruby LSP add-on | tested in CI against the locked and the latest `ruby-lsp` |

## AI providers

Ollama (default), OpenAI-compatible endpoints, Anthropic, and the VS Code Language Model API (`vscode-lm`, no key stored by RailsForge).
Tools are also exposed to agent mode as `railsforge_*` Language Model tools and as a standalone MCP server.
