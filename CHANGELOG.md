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

### Changed
- `@rails` slash commands now run distinct workflows: `/optimize` performs schema-aware N+1 static analysis, `/migrate` runs the strong_migrations checks, `/fix` includes active diagnostics, `/service` `/scaffold` `/spec` ground the prompt in existing patterns, tables and the detected test framework.

### Tests / CI
- Real VS Code Extension Host integration tests (`pnpm run test:host`): activation, command registration, multi-root isolation.
- Ruby LSP add-on Minitest suite runs through ruby-lsp's own add-on loader and Hover request, against the locked and latest ruby-lsp.

- Add optional legal-tech AI guardrails for RailsForge prompts via `railsForge.legal.skills.enabled`.
