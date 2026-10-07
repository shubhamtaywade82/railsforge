# Changelog

## Unreleased

### Fixed
- Extract Service/Query no longer prepends generated code into an existing file; it aborts with an error.
- AI patch hunks are matched to files by exact workspace-relative path (not basename).
- Ruby/Rails versions are never fabricated: undeclared versions are reported as `unknown` and the AI prompt says so. Gemfile `ruby` and Gemfile.lock `RUBY VERSION` are now consulted; Rails prerelease versions parse.
- Schema/routes/migration watchers handle create and delete; Stimulus indexing is recursive at startup and drops deleted controllers.
- Multi-root workspaces: the project root is resolved per file; schema, routes, environment, Stimulus, factories and the rake view follow the active editor's folder. Terminals open in the owning project.
- Test/rake/console terminal commands are quoted for the detected shell (POSIX, PowerShell, cmd).
- Chat sidebar status distinguishes unconfigured / authenticated / error / offline using a real provider probe instead of "API key exists".

- Persistent AST index is per workspace root (own SQLite file, worker and watchers, started lazily, disposed with its folder). When the native module can't load, RailsForge now says why (one-time notice with log link + permanent dismiss, status in the Architecture view, precise command messages) instead of silently disabling the feature.
- Offline DevDocs cache and RBS signature index are per workspace root: each project caches docsets for its own Ruby/Rails versions under its own `.railsforge/devdocs`, hovers/definitions resolve the index from the document's owning root, `Update Offline DevDocs` targets the active project, and a removed folder's state is dropped.
- Project tools (RuboCop, Brakeman, bundler-audit, Steep, RBS, rake, rspec/rails test, console, release) now run through one toolchain resolver: `bin/` binstub, else `bundle exec`, else the bare tool, wrapped in the project's version manager (mise, asdf, rbenv, rvm, chruby) when detected and installed (`railsForge.ruby.versionManager`). RuboCop now runs inside the owning project's root instead of the host's working directory.
- `RailsForge: Rails Generate…` / `Rails Destroy…` run `rails generate|destroy` with validated, shell-free arguments, open the created files and offer RuboCop autocorrect on them.
- Native VS Code tasks (`type: "railsforge"`) for tests, RuboCop, Brakeman and common `db:`/routes commands, with RuboCop, RSpec and Minitest problem matchers.
- Test Explorer: workspace-wide discovery with nested `describe`/`context`/`it` and Minitest classes/`def test_`; one run per file with per-test status, durations, failure locations and streamed output (RSpec JSON, Minitest text); cancellable; a Debug profile that launches the Ruby `rdbg` extension (terminal fallback). CodeLens "Debug" uses the same path.
- Optional code analyzers — Reek, Flog, Flay, Debride, Standard — via `RailsForge: Run Code Analyzers`; findings appear in Problems (`railsForge.analyzers.*`). Parsers are verified against real tool output.
- Opt-in Rails runtime introspection (`rails runner`, trust- and consent-gated): real associations, validations, callbacks, routes and middleware cached in `.railsforge/runtime.json`.
- Ruby LSP add-on 0.2.0: route-helper and column completion, go-to-definition from route helpers to `config/routes.rb` and from `render` to partials.
- Agent-native: every RailsForge MCP tool is also a VS Code Language Model tool (`railsforge_*`, agent mode / `#` references) via one shared implementation (`src/mcp/tools`); package.json's `languageModelTools` is generated from it and checked by a sync test. A native MCP server definition provider registers the bundled server per workspace root. New `get_runtime_introspection` tool.
- `railsForge.ai.provider = "vscode-lm"` uses VS Code's model picker (Copilot or any Language Model provider) through the Language Model API, no API key stored by RailsForge.
- Fixed: the standalone MCP server bundle no longer pulls in `vscode` (CI now guards this).
- Editor context submenu (RailsForge), explorer "Rails Generate…", getting-started and Rake empty states (`viewsWelcome`), `railsforge:` virtual documents (routes, schema, runtime, toolchain) that refresh when schema/routes change, and `workspaceState` memory for the last analyzers/generator.
- **Rails Semantic Graph**: one fact layer over schema, routes, patterns, AST dependency edges and the runtime snapshot, plus new static extractors (controller actions and filters, model associations/validations/callbacks/scopes, views and partials, specs, migrations). Surfaced to the AI agent (injected into every prompt), as the `get_semantic_context` tool and as `railsforge:/graph.md`. `SchemaIndexer` now fills indexes and foreign keys.
- **ruby-agent-skills integration**: a pinned, hash-verified build of the pack is bundled (`skills-pin.json`, `scripts/fetch-skills.mjs`); requests are routed to the most relevant skills (triggers, routing matrix, graph entity kinds, chat command) and their rules injected within a budget. Tools `list_skills` / `route_skills` / `get_skill`, MCP resources `ruby-agent-skills://…`, 20 native `chatSkills`, and `railsForge.skills.*` settings. Project `.agents/skills` override the pack. See `docs/skills-integration.md`.
- **Security:** AI-driven file creation (`createNewFile`, `inferTargetFile`) now resolves paths through a containment-checked resolver: `..` traversal, absolute/drive/UNC escapes, control characters, `.git` targets and symlinks pointing outside the workspace are refused. Existing files are never silently overwritten (the diff preview + confirmation is used); already-absolute inferred paths are no longer joined onto the root twice.
- CI: Windows (x64) and macOS (arm64, x64) jobs run lint, type-check, the production build, a native-module smoke test (`better-sqlite3`, `tree-sitter-ruby`), Vitest, the VS Code host tests and VSIX packaging. `.gitattributes` pins LF line endings; skills pack hashing is line-ending independent.
- Release gate: `pnpm run vsix-smoke` installs the packaged VSIX into a clean VS Code and verifies the installed copy (payload present/sources absent, native modules load in Electron, activation, every command and Language Model tool registered, bundled MCP server answers `tools/list`, native AST index reaches `ready`). Runs in CI on Linux, Windows and macOS.
- Release workflow gates on the installed-VSIX smoke test, publishes the exact smoke-tested file (sha256 re-verified), requires a matching CHANGELOG section, and supports `vX.Y.Z-pre` tags for Marketplace/Open VSX pre-releases.
- **Design Patterns sidebar opens in the editor, not a browser.** Selecting a pattern shows an explanation (`railsforge:/pattern/<id>.md`) with when-to-use, pitfalls, a Ruby example and the project's own matching classes; pattern nodes expand to those classes. 17 patterns with original text (Refactoring.Guru is linked, not copied: its content is CC BY-NC-ND). Fixes dead rows (Query/Policy had no link) and wrong links (Service Object pointed at Command; a Value Object link was a 404). **Explain Pattern in Chat** sends only the pattern text — a new `isolated` agent mode skips schema, routes, graph, skills and editor content. Architecture & Health rows now open the matching `railsforge:` document.
- Release workflow can publish to the Marketplace with Microsoft Entra ID over GitHub OIDC (`--azure-credential`, repository variables `AZURE_CLIENT_ID`/`AZURE_TENANT_ID`), keeping `VSCE_PAT` as a fallback. Dependabot no longer proposes TypeScript major or `@types/vscode` bumps. Repository URLs now point at `shubhamtaywade82/railsforge`.

### Changed
- `@rails` slash commands now run distinct workflows: `/optimize` performs schema-aware N+1 static analysis, `/migrate` runs the strong_migrations checks, `/fix` includes active diagnostics, `/service` `/scaffold` `/spec` ground the prompt in existing patterns, tables and the detected test framework.

### Tests / CI
- Extension Host tests now run through `@vscode/test-cli` (`.vscode-test.mjs`) against both the latest stable VS Code and the `engines` floor (1.96.0); the older `runTest.ts` runner is gone. The extension declares `capabilities.untrustedWorkspaces: false` explicitly, and the runtime-introspection trust/consent gate is unit-tested.
- Real VS Code Extension Host integration tests (`pnpm run test:host`): activation, command registration, multi-root isolation.
- Ruby LSP add-on Minitest suite runs through ruby-lsp's own add-on loader and Hover request, against the locked and latest ruby-lsp.

- Add optional legal-tech AI guardrails for RailsForge prompts via `railsForge.legal.skills.enabled`.
