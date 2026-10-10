# RailsForge — Complete Feature Documentation

> **All-in-one Ruby & Rails IDE extension for VS Code, Cursor, VSCodium, and Windsurf.**
> Version: `0.1.4` · Publisher: `ShubhamTaywade` · License: MIT

---

## Table of Contents

1. [Overview](#1-overview)
2. [Activation & Requirements](#2-activation--requirements)
3. [Feature Index](#3-feature-index)
4. [Feature Reference](#4-feature-reference)
   - [F-01 ActiveRecord Schema Peek](#f-01-activerecord-schema-peek)
   - [F-02 Fast MVC & Resource Navigation](#f-02-fast-mvc--resource-navigation)
   - [F-03 Route Resolver & URL Helper Autocomplete](#f-03-route-resolver--url-helper-autocomplete)
   - [F-04 View & Partial Navigation](#f-04-view--partial-navigation)
   - [F-05 Hotwire, Stimulus & Turbo Intelligence](#f-05-hotwire-stimulus--turbo-intelligence)
   - [F-06 Testing & FactoryBot Intelligence](#f-06-testing--factorybot-intelligence)
   - [F-07 Design Principles Engine](#f-07-design-principles-engine)
   - [F-08 Architecture & Refactoring Tools](#f-08-architecture--refactoring-tools)
   - [F-09 Living Pattern Catalog](#f-09-living-pattern-catalog)
   - [F-10 Cross-File Related Files CodeLens](#f-10-cross-file-related-files-codelens)
   - [F-11 DevSecOps & Static Analysis](#f-11-devsecops--static-analysis)
   - [F-12 Zero-Downtime Migration Safety](#f-12-zero-downtime-migration-safety)
   - [F-13 Semantic Code Search](#f-13-semantic-code-search)
   - [F-14 AST-Backed Deep Analysis](#f-14-ast-backed-deep-analysis)
   - [F-15 Grounded Local AI Agent (`@rails`)](#f-15-grounded-local-ai-agent-rails)
   - [F-16 MCP Server & Cursor Rules Export](#f-16-mcp-server--cursor-rules-export)
   - [F-17 Architecture & Health Sidebar](#f-17-architecture--health-sidebar)
   - [F-18 Version-Aware Documentation Engine](#f-18-version-aware-documentation-engine)
   - [F-19 Standalone Ruby & Gem Support](#f-19-standalone-ruby--gem-support)
   - [F-20 Editing Aids: Endwise, ERB Tags & Gem Lens](#f-20-editing-aids-endwise-erb-tags--gem-lens)
   - [F-21 Project-Type-Aware Tooling & Full Settings Configurability](#f-21-project-type-aware-tooling--full-settings-configurability)
   - [F-22 AI-Assisted Conventional Commits](#f-22-ai-assisted-conventional-commits)
   - [F-23 Restricted Mode & Workspace Trust](#f-23-restricted-mode--workspace-trust)
   - [F-24 Agent Tool Loop with Self-Repair](#f-24-agent-tool-loop-with-self-repair)
   - [F-25 Skill Routing & Safety Rules](#f-25-skill-routing--safety-rules)
   - [F-26 Type Checking (Steep & RBS)](#f-26-type-checking-steep--rbs)
   - [F-27 Code Analyzers (Reek, Flog, Flay, Debride, Standard)](#f-27-code-analyzers-reek-flog-flay-debride-standard)
   - [F-28 Rails Runtime Introspection](#f-28-rails-runtime-introspection)
   - [F-29 Provider Layer Architecture](#f-29-provider-layer-architecture)
5. [Keybindings Reference](#5-keybindings-reference)
6. [Command Palette Reference](#6-command-palette-reference)
7. [Configuration Reference](#7-configuration-reference)
8. [Architecture Overview](#8-architecture-overview)
9. [Relationship to Ruby LSP](#9-relationship-to-ruby-lsp)
10. [Implementation Status](#10-implementation-status)

---

## 1. Overview

RailsForge replaces a fragmented toolchain of 8–12 separate extensions with a **single, deeply integrated platform** for Ruby and Rails development. It provides:

- **Rails-aware intelligence** grounded in the live `db/schema.rb` and `config/routes.rb`
- **Static analysis** via RuboCop, Brakeman, Bundler-Audit, Strong Migrations, Reek, Flog, Flay, Debride, and Standard
- **Architectural tooling**: SOLID/DRY/KISS principle enforcement, pattern extraction, dependency graph analysis
- **Testing integration**: RSpec/Minitest runner, FactoryBot jump-to-definition, VS Code Test Explorer
- **Type checking**: Steep and RBS integration with hover, go-to-definition, and signature generation
- **AI agent** (`@rails`) backed by local Ollama, cloud providers (OpenAI, Anthropic), or VS Code's Language Model API — grounded in your schema, routes, and existing patterns, with an autonomous tool-use loop and `ruby -c` syntax verification
- **Skill routing & safety rules**: AI requests are routed to the most relevant engineering skills, with safety-forced warnings for destructive operations
- **MCP server** so any MCP-capable AI client (Cursor, Claude Code, etc.) can query the same project context
- **Workspace Trust**: Restricted Mode blocks all project code execution in untrusted workspaces
- **AI-assisted Conventional Commits**: generates commit messages from staged diffs, classified by Rails pattern type
- **Provider layer architecture**: every VS Code API call is wrapped behind dedicated Provider classes that consume engine interfaces, keeping the core engine testable without the VS Code runtime

RailsForge is a **companion** to Shopify's `ruby-lsp`, not a replacement. Install both.

---

## 2. Activation & Requirements

### Activation Events
RailsForge activates on any of:
- A file with language `ruby`, `erb`, `haml`, or `slim` is opened
- A workspace contains a `Gemfile`
- A workspace contains `config/routes.rb`

### Requirements

| Requirement | Version |
| :--- | :--- |
| VS Code (or compatible IDE) | `>= 1.85.0` |
| Ruby | `>= 2.7` |
| Rails | `>= 5.2` (optional — plain gem/script support available) |
| Bundler | `Gemfile` + `Gemfile.lock` must be present |
| Ollama *(optional)* | `http://localhost:11434` for `@rails` AI features |
| Node.js *(for AST features)* | `>= 22.14` (N-API 10 required for `better-sqlite3`) |

> [!NOTE]
> AST-Backed Analysis features (F-14) silently disable themselves on older Node/Electron versions. All other features continue working normally.

### Supported File Types

| Extension | Language ID |
| :--- | :--- |
| `.rb`, `.rake`, `.gemspec`, `Gemfile`, `Rakefile`, `Guardfile`, `Podfile` | `ruby` |
| `.erb`, `.html.erb` | `erb` |
| `.haml` | `haml` |
| `.slim` | `slim` |

---

## 3. Feature Index

| ID | Feature | Source Module |
| :--- | :--- | :--- |
| F-01 | ActiveRecord Schema Peek | `rails/SchemaIndexer`, `rails/SchemaHoverProvider` |
| F-02 | Fast MVC & Resource Navigation | `rails/MVCNavigator`, `rails/PolicyNavigator` |
| F-03 | Route Resolver & URL Helper Autocomplete | `rails/RoutesIndexer` |
| F-04 | View & Partial Navigation | `rails/ViewPartialResolver`, `rails/ViewComponentResolver` |
| F-05 | Hotwire, Stimulus & Turbo Intelligence | `hotwire/StimulusIndexer`, `hotwire/StimulusCompletionProvider`, `hotwire/TurboFrameNavigator` |
| F-06 | Testing & FactoryBot Intelligence | `testing/TestCodeLensProvider`, `testing/TestExplorerController`, `testing/FactoryBotResolver` |
| F-07 | Design Principles Engine | `principles/DesignPrincipleLinter` |
| F-08 | Architecture & Refactoring Tools | `refactor/ServiceExtractor`, `refactor/QueryExtractor`, `refactor/FormObjectExtractor`, `refactor/ValueObjectExtractor` |
| F-09 | Living Pattern Catalog | `patterns/ProjectPatternIndexer`, `patterns/PatternCodeLensProvider` |
| F-10 | Cross-File Related Files CodeLens | `graph/RelatedFilesIndex`, `graph/RelatedCodeLensProvider`, `graph/RelatedHoverProvider` |
| F-11 | DevSecOps & Static Analysis | `lint/RuboCopProvider`, `lint/BrakemanProvider`, `lint/BundlerAuditScanner`, `lint/RailsDeprecationLinter` |
| F-12 | Zero-Downtime Migration Safety | `rails/MigrationDiagnostics`, `rails/StrongMigrationsAnalyzer` |
| F-13 | Semantic Code Search | `search/SemanticSearchIndex`, `search/EmbeddingClient` |
| F-14 | AST-Backed Deep Analysis | `indexer/RubyAstParser`, `indexer/PersistentIndexer`, `indexer/DuplicateMethodDetector`, `indexer/PersistentDependencyGraph` |
| F-15 | Grounded Local AI Agent | `agent/RailsAgent`, `agent/RailsRAGContext`, `chat/RailsChatParticipant` |
| F-16 | MCP Server & Cursor Rules Export | `mcp/server.ts`, `mcp/CursorRulesGenerator` |
| F-17 | Architecture & Health Sidebar | `views/RailsArchitectureTreeProvider`, `views/PatternCatalogTreeProvider` |
| F-18 | Version-Aware Docs Engine | `docs/VersionDocsEngine` |
| F-19 | Standalone Ruby & Gem Support | `environment/EnvironmentDetector` |
| F-20 | Editing Aids: Endwise, ERB Tags & Gem Lens | `editing/EndwiseProvider`, `editing/ErbTagCompletionProvider`, `gems/GemLensProvider`, `gems/RubyGemsClient` |
| F-21 | Project-Type-Aware Tooling & Full Settings Configurability | `config/RailsForgeConfig`, `docs/OpenApiSkeletonGenerator`, `gems/GemVersionBumper`, `util/LruCache` |
| F-22 | AI-Assisted Conventional Commits | `providers/ConventionalCommitGenerator`, `providers/SourceControlProvider` |
| F-23 | Restricted Mode & Workspace Trust | `workspace/Trust`, `workspace/ProjectTerminal`, `util/ProjectProcess` |
| F-24 | Agent Tool Loop with Self-Repair | `agent/AgentLoop`, `agent/LoopTools`, `util/RubySyntax` |
| F-25 | Skill Routing & Safety Rules | `skills/SkillRouter`, `skills/SkillContextBuilder`, `skills/SafetyRules` |
| F-26 | Type Checking (Steep & RBS) | `types/SteepProvider`, `types/RBSIndex`, `types/RBSHoverProvider`, `types/RBSDefinitionProvider` |
| F-27 | Code Analyzers | `lint/RubyAnalyzersProvider`, `lint/AnalyzerParsers` |
| F-28 | Rails Runtime Introspection | `rails/RuntimeIntrospector`, `rails/RuntimeIntrospectionService` |
| F-29 | Provider Layer Architecture | `providers/ProviderRegistry`, `providers/WorkspaceFsProvider`, `providers/LanguageIntelligenceProvider`, `providers/TerminalTasksProvider`, `providers/AiChatProvider`, `providers/TestingApiProvider`, `providers/WindowUiProvider`, `providers/SourceControlProvider`, `providers/RefactoringEditProvider`, `providers/PrincipleCodeActionProvider` |

---

## 4. Feature Reference

---

### F-01 ActiveRecord Schema Peek

**Source:** [`rails/SchemaIndexer.ts`](src/rails/SchemaIndexer.ts), [`rails/SchemaHoverProvider.ts`](src/rails/SchemaHoverProvider.ts)

Parses `db/schema.rb` (or `db/structure.sql`) into a live in-memory index and exposes it as hover tooltips.

**Capabilities:**
- **Hover tooltip on any model class** (`User`, `Order`, `Account`) shows a Markdown table of: column name, SQL type, nullability, default value, and foreign keys
- **Zero configuration**: auto-watches `db/schema.rb` and rebuilds on every save (including post-migration runs)
- **Column autocompletion**: `User.where(em…)` completes to `email:` based on actual schema columns
- **Association validation**: auto-completes `has_many`, `belongs_to`, `has_one`, `has_and_belongs_to_many` — validates that referenced foreign keys and model files exist
- **Command**: `RailsForge: Peek Model Schema` (`railsforge.showSchemaPeek`)

**Configuration:**

```json
"railsForge.schema.autoIndex": true
```

---

### F-02 Fast MVC & Resource Navigation

**Source:** [`rails/MVCNavigator.ts`](src/rails/MVCNavigator.ts), [`rails/PolicyNavigator.ts`](src/rails/PolicyNavigator.ts)

One-keystroke jumping across all Rails companion files for the current resource.

**Supported jump targets:**

| Target | File Pattern |
| :--- | :--- |
| Model | `app/models/[resource].rb` |
| Controller | `app/controllers/[resource]_controller.rb` |
| View | `app/views/[resource]/` (Quick Pick for index/show/form/etc.) |
| Spec / Test | `spec/models/[resource]_spec.rb` or `test/models/[resource]_test.rb` |
| Policy | `app/policies/[resource]_policy.rb` |
| Service | `app/services/` |
| Migration | `db/migrate/*_create_[resource].rb` |
| Serializer | `app/serializers/[resource]_serializer.rb` |
| ViewComponent | `app/components/[resource]_component.rb` + template |

**Keybindings:**

| Action | Linux/Win | macOS |
| :--- | :--- | :--- |
| Go to Model | `Alt+R M` | `Cmd+Alt+R M` |
| Go to Controller | `Alt+R C` | `Cmd+Alt+R C` |
| Go to View | `Alt+R V` | `Cmd+Alt+R V` |
| Go to Spec / Test | `Alt+R S` | `Cmd+Alt+R S` |
| Go to Policy | `Alt+R P` | `Cmd+Alt+R P` |

---

### F-03 Route Resolver & URL Helper Autocomplete

**Source:** [`rails/RoutesIndexer.ts`](src/rails/RoutesIndexer.ts)

Real-time indexing of `config/routes.rb` with full autocompletion and navigation.

**Capabilities:**
- **Autocomplete**: named route helpers (`users_path`, `edit_order_url`, `api_v1_products_path`) as you type
- **Hover**: hovering over any route helper shows its HTTP method, URL pattern, and `controller#action` mapping
- **Peek / Jump**: from a route helper, jump directly to the controller action definition
- **Interactive Search**: `Alt+R R` opens a searchable Quick Pick of all defined routes — filter by HTTP verb, URL pattern, or controller action
- **Live re-index**: watches `config/routes.rb` and rebuilds automatically on save

**Configuration:**

```json
"railsForge.routes.autoIndex": true
```

---

### F-04 View & Partial Navigation

**Source:** [`rails/ViewPartialResolver.ts`](src/rails/ViewPartialResolver.ts), [`rails/ViewPartialDefinitionProvider.ts`](src/rails/ViewPartialDefinitionProvider.ts), [`rails/ViewComponentResolver.ts`](src/rails/ViewComponentResolver.ts)

`Ctrl+Click` (or `Cmd+Click`) on any quoted `render` path jumps directly to the resolved partial.

**Supported patterns:**

| Call | Resolves To |
| :--- | :--- |
| `render "shared/navbar"` | `app/views/shared/_navbar.html.erb` |
| `render partial: "users/card"` | `app/views/users/_card.html.erb` |
| `render "users/card", locals: {…}` | (same as above) |

**Supported template extensions**: `.erb`, `.html.erb`, `.haml`, `.slim`

ViewComponent lookups (`render UserCardComponent.new(…)`) are resolved via the `RailsForge: Go to ViewComponent` command (`railsforge.goToComponent`) rather than Ctrl+Click, since the render target is a Ruby object expression, not a quoted string.

---

### F-05 Hotwire, Stimulus & Turbo Intelligence

**Source:** [`hotwire/StimulusIndexer.ts`](src/hotwire/StimulusIndexer.ts), [`hotwire/StimulusCompletionProvider.ts`](src/hotwire/StimulusCompletionProvider.ts), [`hotwire/StimulusAttributeParser.ts`](src/hotwire/StimulusAttributeParser.ts), [`hotwire/StimulusDefinitionProvider.ts`](src/hotwire/StimulusDefinitionProvider.ts), [`hotwire/TurboFrameNavigator.ts`](src/hotwire/TurboFrameNavigator.ts), [`hotwire/TurboFrameDefinitionProvider.ts`](src/hotwire/TurboFrameDefinitionProvider.ts)

Full IDE intelligence for Hotwire (Stimulus + Turbo) inside ERB/HAML/Slim templates.

**Stimulus Autocompletion:**
- Dynamically indexes `app/javascript/controllers/` on startup and on save
- Autocompletes `data-controller` values from your actual registered controllers
- Autocompletes `data-action` format: `click->controller#action` — resolves the controller class and its action methods
- Autocompletes `data-[controller]-target` values from the controller's `static targets` array

**Stimulus ↔ TypeScript/JavaScript Navigation:**
- `Ctrl+Click` / `Cmd+Click` on a `data-controller="foo"` identifier jumps straight to `foo_controller.js`/`.ts`, honoring multiple space-separated identifiers on the same attribute
- `Ctrl+Click` / `Cmd+Click` on a `data-action="click->foo#bar"` descriptor jumps to the exact `bar()` method inside the controller file

**Turbo Frame Navigation:**
- `Ctrl+Click` / `Cmd+Click` on `<%= turbo_frame_tag "cart" %>` or `<turbo-frame id="cart">` jumps to every other occurrence of that frame id across `app/views/**`
- Resolves frame IDs cross-file so you can trace the complete Turbo Frame chain
- Live re-indexing: `app/views/**/*.{erb,haml,slim}` is scanned on startup and re-indexed on save/create/delete

---

### F-06 Testing & FactoryBot Intelligence

**Source:** [`testing/TestCodeLensProvider.ts`](src/testing/TestCodeLensProvider.ts), [`testing/TestExplorerController.ts`](src/testing/TestExplorerController.ts), [`testing/FactoryBotResolver.ts`](src/testing/FactoryBotResolver.ts)

Native VS Code Test Explorer integration plus inline CodeLens for RSpec and Minitest.

**Test Explorer Integration:**
- Automatically discovers and populates the VS Code Test sidebar with `spec/` (RSpec) and `test/` (Minitest) hierarchies
- Tests appear as a structured tree: describe/context/it blocks for RSpec, class/method for Minitest

**Inline CodeLens (above every `describe`, `context`, `it`, `test` block):**
- `▶ Run Test` — executes the specific test in an isolated terminal
- `🐞 Debug (rdbg)` — launches a Ruby 3.1+ native debugger (`rdbg`) session for that test

**FactoryBot Intelligence:**
- `Ctrl+Click` / `Cmd+Click` on `create(:user)`, `build(:order)`, or `build_stubbed(:account)` jumps to the factory declaration in `spec/factories/*.rb`
- Factory name autocompletion with attribute hints when writing `create(…)` calls

**Configuration:**

```json
"railsForge.testing.framework": "rspec"  // or "minitest"
```

---

### F-07 Design Principles Engine

**Source:** [`principles/DesignPrincipleLinter.ts`](src/principles/DesignPrincipleLinter.ts)

Live diagnostics enforcing SOLID, DRY, KISS, YAGNI, and Law of Demeter — with deterministic Quick Fixes and optional AI fixes.

**Principles enforced:**

| Principle | Detection | Quick Fix |
| :--- | :--- | :--- |
| **SRP** (Single Responsibility) | Fat Models > 200 LOC or > 10 actions; Fat Controllers > 7 actions | *"Extract to Service Object"* — atomic `WorkspaceEdit` (creates file + replaces selection only) |
| **Law of Demeter** | Deep chain violations: `user.account.billing.address.city` | Inserts `delegate :city, to: :address` (and so on up the chain) |
| **KISS** | Unnecessary dynamic metaprogramming (`define_method`, `class_eval`) for static logic | Informational warning |
| **YAGNI** | Unused private helper methods | Quick Fix: deletes the entire unused method block |
| **Hard-coded Collaborators** | `PaymentGatewayService.call(…)` direct references in other indexed patterns | *"Inject `X` via constructor"* — adds keyword constructor param, rewrites call sites in same file |

**AI Suggest Fix:** every principle diagnostic also offers **✨ AI: Suggest fix** backed by the local `@rails` agent (reuses your Ollama config, no separate model needed).

**Batch Fix:** `RailsForge: Fix All Deterministic Principle Violations in File` (`railsforge.fixAllInFile`) applies all non-AI Quick Fixes across the file in one operation.

**Scope:** fires in `app/models`, `app/controllers`, `app/services`, and `lib/` (generic guidance in `lib/` instead of Rails-specific `app/` quick fix paths).

---

### F-08 Architecture & Refactoring Tools

**Source:** [`refactor/ServiceExtractor.ts`](src/refactor/ServiceExtractor.ts), [`refactor/QueryExtractor.ts`](src/refactor/QueryExtractor.ts), [`refactor/FormObjectExtractor.ts`](src/refactor/FormObjectExtractor.ts), [`refactor/ValueObjectExtractor.ts`](src/refactor/ValueObjectExtractor.ts), [`refactor/DuplicateCallSiteFinder.ts`](src/refactor/DuplicateCallSiteFinder.ts), [`refactor/SpecFileGenerator.ts`](src/refactor/SpecFileGenerator.ts)

Select code in the editor and extract it to the right Rails pattern — in a **single atomic `WorkspaceEdit`** that VS Code previews as one multi-file diff.

**Extractors:**

| Command | Output File | Pattern |
| :--- | :--- | :--- |
| `RailsForge: Extract Selection to Service Object` | `app/services/[name]_service.rb` | `ApplicationService.call` idiom with Result monad |
| `RailsForge: Extract Selection to Query Object` | `app/queries/[name]_query.rb` | Chainable ActiveRecord query object |
| Extract to Form Object | `app/forms/[name]_form.rb` | Multi-model form with `ActiveModel` validations |
| Extract to Value Object | `app/values/[name].rb` | Immutable value type |
| Extract to Policy (Pundit) | `app/policies/[name]_policy.rb` | `Pundit::Policy` skeleton |

**Smart free-variable detection:** automatically detects `params`, `current_user`, and any `receiver.method` in the selected code — extracted service receives them as constructor keyword arguments instead of always generating a zero-arg service.

**Duplicate call-site detection (AST-backed):** after extraction, scans the workspace for **exact duplicates** of the selected code and offers to replace them all in the same multi-file edit.

**Auto-generated spec skeleton:** if a `spec/` directory exists, generates a companion `spec/services/[name]_service_spec.rb` (or `spec/queries/`) alongside the new file — so extraction never leaves zero test coverage.

**Refactoring Menu:** `RailsForge: Refactor Selection (Design Patterns)` opens a Quick Pick of all applicable extractors for the current selection.

---

### F-09 Living Pattern Catalog

**Source:** [`patterns/ProjectPatternIndexer.ts`](src/patterns/ProjectPatternIndexer.ts), [`patterns/PatternCodeLensProvider.ts`](src/patterns/PatternCodeLensProvider.ts), [`patterns/PatternRecognitionEngine.ts`](src/patterns/PatternRecognitionEngine.ts), [`patterns/PatternDiagnosticsProvider.ts`](src/patterns/PatternDiagnosticsProvider.ts)

Indexes your **own project's** existing patterns so you never accidentally write a second `CreateOrderService` when one already exists.

**Indexed directories** (anywhere in the path — not just under `app/`):
`services/`, `queries/`, `forms/`, `policies/`, `decorators/`, `concerns/`

**CodeLens on every Service/Query/Form/Policy class:** `📋 N similar patterns in this project`

**`RailsForge: Show Similar Patterns in This Project`** (`railsforge.showSimilarPatterns`): ranked Quick Pick of closest existing implementations by name and public-method overlap — check for prior art before writing new code.

**Live re-indexing:** triggers on file save, create, and delete. No separate build step.

**AI grounding:** the `@rails` agent's context includes a summary of existing patterns with an explicit "search before generating" instruction — generated code is steered toward your existing conventions.

**Design Patterns Sidebar:** the `Design Patterns (Refactoring Guru)` sidebar panel provides a static reference catalog of GoF and Rails patterns for guidance.

---

### F-10 Cross-File Related Files CodeLens

**Source:** [`graph/RelatedFilesIndex.ts`](src/graph/RelatedFilesIndex.ts), [`graph/RelatedCodeLensProvider.ts`](src/graph/RelatedCodeLensProvider.ts), [`graph/RelatedHoverProvider.ts`](src/graph/RelatedHoverProvider.ts), [`graph/MinimalDependencyGraph.ts`](src/graph/MinimalDependencyGraph.ts)

Eliminates the "open 5–6 files just to understand this class" loop by showing all related files inline.

**On a model** (`app/models/*.rb`), CodeLens above the class definition shows:
```
🔗 3 Services · 2 Queries · 1 Policy · 6 Specs
```
This is every indexed pattern that references the model by name or by `Model.find` / `.create` / `.where`-style usage, plus its spec count.

**On a service/query/policy/decorator**, CodeLens shows:
```
🔗 Called by 7 · Depends on 3 · 2 Specs
```
Sourced from `MinimalDependencyGraph`'s collaborator graph.

**Hover**: the `class` line hover shows the same information without requiring a click.

**`RailsForge: Show Related Files`** (`railsforge.showRelatedFiles`): opens a Quick Pick of everything found — services, queries, policies, callers, collaborators, and specs — each item jumps to the exact line.

**Dependency diagnostics:** [`graph/DependencyDiagnosticsProvider.ts`](src/graph/DependencyDiagnosticsProvider.ts) surfaces coupling issues from the same graph as editor diagnostics.

---

### F-11 DevSecOps & Static Analysis

**Source:** [`lint/RuboCopProvider.ts`](src/lint/RuboCopProvider.ts), [`lint/BrakemanProvider.ts`](src/lint/BrakemanProvider.ts), [`lint/BundlerAuditScanner.ts`](src/lint/BundlerAuditScanner.ts), [`lint/RailsDeprecationLinter.ts`](src/lint/RailsDeprecationLinter.ts)

#### RuboCop Real-Time Engine

- **Live diagnostics** using the project-local `.rubocop.yml` — no global config overrides
- **Inline lightbulb** Quick Fix actions on every offense:
  - `RuboCop: Auto-correct this offense` (safe, `-a`)
  - `RuboCop: Auto-correct entire file` (safe or unsafe, configurable)
  - `RuboCop: Disable cop for line` — inserts `# rubocop:disable CopName`
  - `RuboCop: Disable cop for file` — inserts `# rubocop:disable CopName` at top
- **Format on Save** via `railsForge.rubocop.autocorrectOnSave`

**Configuration:**
```json
"railsForge.rubocop.autocorrectOnSave": true,
"railsForge.rubocop.mode": "safe"  // or "unsafe"
```

#### Brakeman Security Audits

- **On-demand** via `RailsForge: Run Brakeman Security Scan`
- **Optionally on save** via `railsForge.brakeman.scanOnSave`
- Reports: SQL injection, mass assignment, XSS, command injection, unsafe redirects, exposed secrets

**Configuration:**
```json
"railsForge.brakeman.scanOnSave": false
```

#### Bundler-Audit Dependency Scanner

- `RailsForge: Run Gemfile.lock Security Audit (bundle-audit)` audits `Gemfile.lock` against the known CVE advisory database

#### Rails Deprecation Linter

- [`lint/RailsDeprecationLinter.ts`](src/lint/RailsDeprecationLinter.ts) — detects deprecated Rails APIs relative to the active Rails version (detected from `Gemfile.lock`)

---

### F-12 Zero-Downtime Migration Safety

**Source:** [`rails/MigrationDiagnostics.ts`](src/rails/MigrationDiagnostics.ts), [`rails/StrongMigrationsAnalyzer.ts`](src/rails/StrongMigrationsAnalyzer.ts)

Live linter for `db/migrate/*.rb` that warns against table-locking operations in production migrations.

**Detected anti-patterns:**
- `add_column` with a non-null default (locks table on Postgres < 11)
- `add_index` without `algorithm: :concurrently`
- `remove_column` without a prior `ignore_columns`
- `rename_column` / `rename_table` (requires a 3-step deployment)
- `change_column` type changes

**Quick Fix:** inserts `algorithm: :concurrently` and a `disable_ddl_transaction!` header where applicable.

**Command:** `RailsForge: Check Migration Safety (Strong Migrations)` (`railsforge.analyzeMigration`)

---

### F-13 Semantic Code Search

**Source:** [`search/SemanticSearchIndex.ts`](src/search/SemanticSearchIndex.ts), [`search/EmbeddingClient.ts`](src/search/EmbeddingClient.ts)

Find existing code by **meaning**, not just file or class name.

**Command:** `RailsForge: Semantic Search (find similar code by meaning)` (`railsforge.semanticSearch`)

**Usage:** type a description like `"charge a card"` or `"send a welcome email"` — ranked matches appear across all indexed Services, Queries, Policies, Forms, and Decorators, even when the class name doesn't contain your query words.

**Two modes (automatic fallback):**

| Mode | When Active | Label |
| :--- | :--- | :--- |
| 🧠 Semantic | Ollama + embedding model available | Cosine similarity on Ollama embeddings |
| 🔤 Keyword | Ollama or embedding model unavailable | Token-overlap over name/methods/preview |

**Embedding cache:** one vector per pattern, keyed by file path + line + preview. Only re-embeds when a pattern's content changes. No SQLite or vector DB dependency — pure in-memory.

**Configuration:**
```json
"railsForge.ollama.embeddingModel": "nomic-embed-text"
```
> Pull with: `ollama pull nomic-embed-text`

---

### F-14 AST-Backed Deep Analysis

**Source:** [`indexer/RubyAstParser.ts`](src/indexer/RubyAstParser.ts), [`indexer/PersistentIndexer.ts`](src/indexer/PersistentIndexer.ts), [`indexer/PersistentIndexClient.ts`](src/indexer/PersistentIndexClient.ts), [`indexer/DuplicateMethodDetector.ts`](src/indexer/DuplicateMethodDetector.ts), [`indexer/PersistentDependencyGraph.ts`](src/indexer/PersistentDependencyGraph.ts)

A **second, complementary index** alongside the regex-based one — built with real Ruby AST parsing (`tree-sitter-ruby`) and persisted to `.railsforge/index.sqlite3` (gitignore it).

#### Infrastructure

- **Off-thread**: all parsing and SQLite writes run in a `worker_threads` worker — the extension host thread is never blocked
- **Persistent**: survives VS Code restarts; content-hash based so unchanged files are skipped on re-index
- **Workspace-local DB**: `.railsforge/index.sqlite3` — accessible by the standalone MCP server without needing VS Code's internal storage paths
- **Graceful degradation**: if `better-sqlite3` or `tree-sitter` can't load (unsupported Node/Electron version), all F-14 features silently disable. Nothing else in RailsForge is affected.

> [!IMPORTANT]
> `better-sqlite3` requires **Node >= 22.14** (N-API version 10). VS Code/Cursor/Windsurf builds on older Electron will skip these features. Check: `process.versions.napi >= 10`.

#### AST Parser (`RubyAstParser`)

Extracts from real parse trees (not regex):
- Classes (with superclass)
- `include` / `prepend` / `extend` modules
- Public and private methods (with full body text and constructor params)
- Method calls (with receiver)

#### SQLite Schema

Tables: `symbols`, `methods`, `dependencies`, `embeddings`

#### F-14a: Find Near-Duplicate Methods (DRY)

**Command:** `RailsForge: Find Near-Duplicate Methods (DRY)` (`railsforge.findDuplicateMethods`)

Uses **Jaccard token-overlap similarity** over normalized method bodies across the entire codebase — not just line-count heuristics. Catches two methods with the same logic under different names or in different files.

#### F-14b: Show Circular Dependencies

**Command:** `RailsForge: Show Circular Dependencies` (`railsforge.showDependencyCycles`)

DFS cycle detection (A → B → C → A) over an AST-derived dependency graph that includes `include` / `prepend` / `extend`, not only `.call` / `.new`. Surfaces cycles as a Quick Pick list with jump-to-file.

---

### F-15 Grounded Local AI Agent (`@rails`)

**Source:** [`agent/RailsAgent.ts`](src/agent/RailsAgent.ts), [`agent/RailsRAGContext.ts`](src/agent/RailsRAGContext.ts), [`chat/RailsChatParticipant.ts`](src/chat/RailsChatParticipant.ts), [`chat/RailsChatViewProvider.ts`](src/chat/RailsChatViewProvider.ts)

A `@rails` VS Code / Cursor Chat Participant backed by a local Ollama model — grounded in your actual project context.

#### Anti-Hallucination Grounding

The system prompt is constructed dynamically from:
- Active Ruby version (from `.ruby-version` or `Gemfile.lock`)
- Active Rails version (from `Gemfile.lock` — or `"Not a Rails app"` if absent)
- Relevant schema tables and column definitions
- Route mappings
- A summary of existing Service/Query/Form/Policy patterns in the project
- An explicit **"search before generating"** instruction — the agent must reuse a close existing match before creating new code

#### Slash Commands

| Command | Description |
| :--- | :--- |
| `@rails /explain` | Explain complex queries, scopes, associations, or code in context |
| `@rails /fix` | Diagnose and apply minimal fixes for active RuboCop, Brakeman, or RSpec errors |
| `@rails /service` | Scaffold a clean Service Object with error handling and Result monads |
| `@rails /scaffold` | Generate convention-compliant models, controllers, migrations, and views |
| `@rails /spec` | Generate complete, idiomatic RSpec unit/request specs using FactoryBot |
| `@rails /migrate` | Generate a safe, reversible ActiveRecord migration with index optimizations |
| `@rails /optimize` | Analyze queries, detect N+1 risks, and suggest eager-loading fixes |

#### Self-Repairing Agent Loop (F-24)

The `@rails` agent can autonomously use tools (read files, run RuboCop, run RSpec, apply patches) in a loop until the task is complete — with `ruby -c` syntax verification between steps. Configurable via `railsForge.agent.toolLoop`, `railsForge.agent.maxToolSteps`, and `railsForge.agent.verifyRubySyntax`. See F-24 for full details.

#### Configuration

```json
"railsForge.ai.provider": "ollama",
"railsForge.ollama.host": "http://localhost:11434",
"railsForge.ollama.model": "qwen2.5-coder:14b"
```

**AI providers:**
- `"ollama"` (default) — local, private, no API key needed
- `"openai"` — OpenAI-compatible endpoints (OpenRouter, self-hosted vLLM)
- `"anthropic"` — Anthropic Claude models
- `"vscode-lm"` — VS Code's Language Model API (Copilot or any Language Model provider extension); no API key stored by RailsForge

Recommended Ollama models: `qwen2.5-coder:14b` (best) or `qwen2.5-coder:7b` (faster, lower RAM).

---

### F-16 MCP Server & Cursor Rules Export

**Source:** [`mcp/server.ts`](src/mcp/server.ts), [`mcp/CursorRulesGenerator.ts`](src/mcp/CursorRulesGenerator.ts)

Exposes RailsForge's project intelligence to **any MCP-capable AI client** — not just the built-in `@rails` agent.

#### MCP Server (`dist/mcp/server.js`)

Standalone Node process (separate webpack entry, not loaded by the extension host). Communicates via stdio using `@modelcontextprotocol/sdk`.

**Exposed MCP tools:**

| Tool | Description |
| :--- | :--- |
| `get_schema` | Returns the parsed `db/schema.rb` index (tables, columns, types) |
| `list_routes` | Returns all defined routes with HTTP verb, URL, and controller#action |
| `list_patterns` | Returns all indexed Services/Queries/Forms/Policies/Decorators |
| `find_similar_pattern` | Ranked search for patterns similar to a given name or description |
| `get_dependencies` | Returns the collaborator graph for a given class |
| `find_duplicate_methods` | Returns near-duplicate method pairs across the codebase |

#### Cursor Rules Export

**Command:** `RailsForge: Export Cursor Rules & Register MCP Server` (`railsforge.exportCursorRules`)

Writes `.cursor/rules/railsforge.mdc` containing: schema summary, route table, existing pattern catalog, and the "search before generating" rule. Merge-registers the MCP server entry into `.cursor/mcp.json` without overwriting other configured servers.

---

### F-17 Architecture & Health Sidebar

**Source:** [`views/RailsArchitectureTreeProvider.ts`](src/views/RailsArchitectureTreeProvider.ts), [`views/PatternCatalogTreeProvider.ts`](src/views/PatternCatalogTreeProvider.ts)

Dedicated Activity Bar panel with three views:

#### RailsForge AI Assistant (Webview)
Inline chat panel for the `@rails` agent — alternative to the VS Code Chat sidebar.

#### Architecture & Health Tree
Live read-out of the project environment:
- **Runtime**: Ruby version, Rails version (or "Not a Rails app"), Hotwire detected, testing framework
- **Database & Models**: indexed table count, column totals
- **Routes & Hotwire**: total route count, registered Stimulus controller count
- **Migration safety status**

#### Design Patterns Sidebar
`Design Patterns (Refactoring Guru)` — static catalog of GoF and Rails-native patterns as a browsable tree for reference while writing or reviewing code.

---

### F-18 Version-Aware Documentation Engine

**Source:** [`docs/VersionDocsEngine.ts`](src/docs/VersionDocsEngine.ts)

Contextual hover documentation for core Rails DSLs — version-aware based on the active `Gemfile.lock`.

**Covered DSLs:**
`has_many`, `belongs_to`, `has_one`, `has_and_belongs_to_many`, `turbo_stream`, `before_action`, `after_action`, `delegate`, `scope`, `validates`, `validate`, and others.

**Hover content includes:**
- Concise explanation of the DSL keyword
- Key options and their types
- A canonical usage example
- Direct link to the official Rails Guide section and the Ruby Style Guide

---

### F-19 Standalone Ruby & Gem Support

**Source:** [`environment/EnvironmentDetector.ts`](src/environment/EnvironmentDetector.ts)

RailsForge activates on **any Ruby file or Gemfile** — not only full Rails applications.

**Behavior when `hasRails: false`** (no `rails` entry in `Gemfile.lock`):

| Feature | Rails App | Standalone Ruby / Gem |
| :--- | :--- | :--- |
| Schema / Route indexing | ✅ | ❌ (silently skipped) |
| MVC navigation | ✅ | ❌ (silently skipped) |
| Migration safety | ✅ | ❌ (silently skipped) |
| Hotwire/Stimulus tooling | ✅ | ❌ (silently skipped) |
| Pattern catalog | ✅ (`app/services`, etc.) | ✅ (`lib/my_gem/services`, etc.) |
| SRP / SOLID linting | ✅ (Rails-specific quick fixes) | ✅ (generic guidance in `lib/`) |
| `@rails` AI agent | ✅ (Rails-grounded) | ✅ (plain-Ruby/SOLID mode) |
| Architecture sidebar | ✅ (full) | ✅ (shows "Not a Rails app") |

Pattern catalog matches `services/`, `queries/`, `forms/`, `policies/`, `decorators/`, `concerns/` **anywhere in the path** — so `lib/my_gem/services/*.rb` is indexed identically to `app/services/*.rb`.

**Project type classification (`ProjectEnvironment.projectType`):** every workspace is further classified as one of `monolith` | `api_only` | `gem` | `script`, shown in the Architecture sidebar and passed through to `@rails`/Cursor grounding via `CursorRulesGenerator`:

| projectType | Detected when | AI grounding note |
| :--- | :--- | :--- |
| `monolith` | `hasRails` and not API-only | none (full MVC assumed) |
| `api_only` | `hasRails` and `config.api_only = true` in `config/application.rb`, or `ApplicationController < ActionController::API` | "don't suggest ERB/HAML/Slim views, helpers, or the asset pipeline" |
| `gem` | not `hasRails` and a `*.gemspec` exists at the workspace root | "don't assume ActiveRecord/ActionController APIs are available" |
| `script` | not `hasRails` and no `.gemspec` | none beyond the existing standalone-Ruby note |

---

### F-20 Editing Aids: Endwise, ERB Tags & Gem Lens

**Source:** [`editing/EndwiseProvider.ts`](src/editing/EndwiseProvider.ts), [`editing/ErbTagCompletionProvider.ts`](src/editing/ErbTagCompletionProvider.ts), [`gems/GemLensProvider.ts`](src/gems/GemLensProvider.ts), [`gems/RubyGemsClient.ts`](src/gems/RubyGemsClient.ts), [`gems/GemNameParser.ts`](src/gems/GemNameParser.ts)

Three small, zero-configuration authoring aids that replace standalone marketplace extensions.

**Endwise (auto-`end`):**
- Pressing Enter after a line that opens a Ruby block — `def`, `class`, `module`, `case`, `begin`, `for`, leading `if`/`unless`/`while`/`until`, a trailing `do`, or an assigned `x = if …` expression — inserts a matching `end` on the next line, indented to match the opener
- Deliberately does **not** fire for statement modifiers (`return foo if bar`), block-continuation keywords (`else`, `elsif`, `when`, `rescue`, `ensure`), brace blocks (`{ |x| … }`), or lines already closed on the same line (`def foo; end`)

**Simple Ruby ERB (tag expansion):**
- Typing `<%` in an `.erb` file offers three snippet completions: `<%= %>` (output), `<% %>` (execution), and `<%# %>` (comment), cursor placed between the tags

**Gem Lens:**
- Hovering a gem name in `Gemfile` (e.g. `gem "rails"`) fetches its latest published version, summary, and documentation/homepage links from the [RubyGems.org API](https://guides.rubygems.org/rubygems-org-api/)
- Results are cached (bounded by `railsForge.performance.cacheSize`) per gem name for the life of the session; network failures degrade to no hover rather than an error

---

### F-21 Project-Type-Aware Tooling & Full Settings Configurability

**Source:** [`config/RailsForgeConfig.ts`](src/config/RailsForgeConfig.ts), [`docs/OpenApiSkeletonGenerator.ts`](src/docs/OpenApiSkeletonGenerator.ts), [`gems/GemVersionBumper.ts`](src/gems/GemVersionBumper.ts), [`util/LruCache.ts`](src/util/LruCache.ts)

Every `railsForge.*` setting is a real, wired-up control (not a declared-but-unused stub) — see §7 for the complete reference. This feature groups everything that makes RailsForge adapt to *which kind* of Ruby/Rails project it's in, beyond what F-19 already covers.

**Project type detection & override:**
- `railsForge.projectType.override` forces `monolith`/`api_only`/`gem`/`script` over auto-detection (see F-19 for how auto-detection itself works)
- The Command Palette and keybindings (`Alt+R M/C/V/R`) only show commands relevant to the detected/overridden type — a `gem` project never sees "Go to View", an `api_only` app never sees it either (no `app/views`), and `goToPolicy`/`goToComponent` stay hidden unless Pundit/ViewComponent are actually in `Gemfile.lock`

**Workspace-wide exclude patterns:**
- `railsForge.excludePatterns` is honored by every scan RailsForge runs: schema/routes/pattern/spec indexing, Turbo Frame indexing, the AST index (on top of its own always-on spec/test exclusion), and live re-indexing on save
- Set at the workspace level to exclude a vendored engine's dummy app (`spec/dummy`), a generated docs folder, or anything else specific to that project, on top of (or instead of) the sane defaults
- The standalone MCP server process (outside the extension host) reads the same setting from the workspace's `.vscode/settings.json`

**API doc generation (`railsforge.generateApiDocs`):**
- Builds a minimal OpenAPI 3.0 YAML skeleton from the indexed route table — paths (with `:id` converted to `{id}`), HTTP methods, `operationId`, and a `TODO` response placeholder per route
- Gated by `railsForge.apiDocs.enabled`; most useful for `api_only` projects where every route is a real API endpoint

**Gem publishing helpers (`gem` project type only):**
- `railsforge.bumpGemVersion`: finds `lib/**/version.rb`, offers a major/minor/patch QuickPick against the current `VERSION`, rewrites it in place
- `railsforge.releaseGem`: runs `bundle exec rake release` — behind a modal confirmation, since it pushes a git tag and publishes to RubyGems.org

**Cloud AI providers:**
- `railsForge.ai.provider` switches the `@rails` agent between `ollama` (default, local/private), `openai`, and `anthropic`
- API keys never touch `settings.json` — `railsforge.setAiApiKey` stores them in VS Code's `SecretStorage`, scoped per provider

**Bounded caches:**
- `railsForge.performance.cacheSize` caps Gem Lens's gem-info cache and Semantic Search's embedding cache with LRU eviction, instead of growing unbounded for the life of the session

---

### F-22 AI-Assisted Conventional Commits

**Source:** [`providers/ConventionalCommitGenerator.ts`](src/providers/ConventionalCommitGenerator.ts), [`providers/SourceControlProvider.ts`](src/providers/SourceControlProvider.ts)

Generates a [Conventional Commit](https://www.conventionalcommits.org/) message from your staged `git diff`, classified by Rails pattern type.

**How it works:**
1. Runs `git diff --cached` in the workspace root
2. Parses the diff into per-file entries (path, status, additions, deletions)
3. Infers the commit type (`feat`, `fix`, `refactor`, `test`, `chore`) from file paths and change types
4. Infers the scope from newly-added pattern instances first (a new Service Object takes scope priority), then from the primary file, then from the Rails directory segment
5. Pushes the result into the Git SCM input box (the same API Copilot uses), with clipboard fallback

**How to use:**
- Click the ✨ sparkle button in the Source Control view title bar or input box
- Or run **RailsForge: Generate Conventional Commit** from the Command Palette
- The generated message appears in the commit input box — edit it before committing

**Example output:**
```
feat(service): add CheckoutService
refactor(controller): update OrdersController
test: add checkout_spec
```

**Scope inference priority:**
1. Newly-added pattern instances (Service/Query/Form/Policy) matched against the `PatternCatalogAccess`
2. Primary file (most diff lines) matched against project patterns
3. Rails directory segment (`app/services` → `service`, `app/controllers` → `controller`)
4. Special paths (`db/migrate` → `migration`, `config/routes.rb` → `routes`, `spec/` → `test`)

---

### F-23 Restricted Mode & Workspace Trust

**Source:** [`workspace/Trust.ts`](src/workspace/Trust.ts), [`workspace/ProjectTerminal.ts`](src/workspace/ProjectTerminal.ts), [`util/ProjectProcess.ts`](src/util/ProjectProcess.ts)

RailsForge respects VS Code's Workspace Trust system. When a workspace is in Restricted Mode (untrusted), all features that execute project code are blocked.

**What works in Restricted Mode (read-only tier):**
- Navigation (MVC, schema peek, routes, partials, Stimulus, Turbo)
- Semantic graph and pattern catalog
- Virtual documents (routes, schema, runtime, toolchain overviews)
- AI chat (grounded in already-indexed data)
- Design principle diagnostics (static analysis only)

**What is blocked in Restricted Mode:**
- RuboCop, Brakeman, bundler-audit, Steep, analyzers (run project code)
- Rails console, REPL evaluation, `rails generate`/`destroy`
- Test execution and debugging (`rdbg`)
- `rails runner` runtime introspection
- Terminals and task execution
- File save hooks that trigger project tooling

**Trust-gated wrappers (enforced by `test/TrustGuard.test.ts`):**
- `createProjectTerminal()` / `sendToTerminal()` — all terminal creation goes through these wrappers, which call `assertTrusted()` before `vscode.window.createTerminal()`
- `ProjectProcess` — all `child_process` usage (`execFile`, `spawn`) goes through `assertTrusted()`
- A static analysis test (`TrustGuard.test.ts`) scans the entire `src/` tree to ensure no raw `vscode.window.createTerminal`, `terminal.sendText`, `child_process`, `startDebugging`, or `executeTask` calls bypass the wrappers

**How to use:**
- Open a workspace → VS Code prompts to trust it
- Click "Trust" → all features activate
- Click "Don't trust" → Restricted Mode (read-only features only)
- The Architecture sidebar shows trust status

---

### F-24 Agent Tool Loop with Self-Repair

**Source:** [`agent/AgentLoop.ts`](src/agent/AgentLoop.ts), [`agent/LoopTools.ts`](src/agent/LoopTools.ts), [`util/RubySyntax.ts`](src/util/RubySyntax.ts)

The `@rails` agent can autonomously use tools (read files, run RuboCop, run RSpec, apply patches) in a loop until the task is complete — with Ruby syntax verification between steps.

**How it works:**
1. The agent receives a prompt (e.g., `/fix` or a free-form request)
2. It generates a response that may include tool calls
3. Each tool call is executed (read file, run linter, apply patch)
4. The result is fed back into the agent
5. The loop continues until the agent signals completion or `maxToolSteps` is reached
6. Between steps, `ruby -c` syntax verification catches malformed code before it's applied

**Tools available to the agent:**
- `get_schema` / `list_routes` / `list_patterns` / `find_similar_pattern` / `get_dependencies` / `find_duplicate_methods` — the same MCP tools exposed to external clients
- `get_runtime_introspection` — real associations, validations, callbacks from a booted Rails app
- `get_gem_documentation` — RubyGems docs lookup
- `route_skills` — picks the most relevant engineering skills for the task

**Configuration:**

```json
"railsForge.agent.toolLoop": true,
"railsForge.agent.maxToolSteps": 3,
"railsForge.agent.verifyRubySyntax": true
```

- `toolLoop`: enable/disable the autonomous tool-use loop
- `maxToolSteps`: maximum number of tool iterations before the agent stops (prevents infinite loops)
- `verifyRubySyntax`: run `ruby -c` on generated code before applying it (catches syntax errors early)

**Self-repair flow:**
```
User prompt → Agent generates code → ruby -c syntax check →
Apply patch → Run RuboCop → If offenses → Agent fixes →
Run RSpec → If failures → Agent fixes → Done
```

---

### F-25 Skill Routing & Safety Rules

**Source:** [`skills/SkillRouter.ts`](src/skills/SkillRouter.ts), [`skills/SkillContextBuilder.ts`](src/skills/SkillContextBuilder.ts), [`skills/SafetyRules.ts`](src/skills/SafetyRules.ts), [`skills/SkillCatalog.ts`](src/skills/SkillCatalog.ts), [`skills/SkillRegistry.ts`](src/skills/SkillRegistry.ts)

Routes each AI request to the most relevant engineering skills (bundled, pinned Ruby/Rails domain documentation), with safety-forced rules that warn about destructive operations.

**How it works:**
1. The `route_skills` tool (also exposed as an MCP/Language Model tool) takes a task description and optionally the active file
2. It returns the smallest set of skills that apply: primary, secondary, and always-on cross-cutting skills
3. Safety-forced skills are injected when the task involves destructive commands, SQL injection risks, mass assignment, or risky migrations
4. The agent reads the matched skills with `get_skill` before generating code

**Bundled skill domains:**
- `rails-action-controller` — request handling, parameters, responses, sessions, callbacks, exceptions
- `rails-active-record` — persistence, relations, queries, callbacks, testing, bulk writes, loading, security, tenant scope
- `ruby-clean-code` — SOLID, DRY, KISS, YAGNI, Demeter

**Safety rules:**
- Destructive commands (`drop_table`, `delete_all`, `destroy`) → safety warning injected
- SQL injection risk (`where("... #{}")`) → safety warning injected
- Mass assignment risk (`new(params)`) → safety warning injected
- Risky migrations (`remove_column`, `rename_column`) → safety warning injected

**Configuration:**

```json
"railsForge.skills.enabled": true,
"railsForge.skills.maxPerRequest": 4,
"railsForge.skills.extraPaths": []
```

- `enabled`: toggle skill routing on/off
- `maxPerRequest`: maximum domain skills injected per request (cross-cutting skills like `ruby-clean-code` are always included)
- `extraPaths`: additional skill directories to load beyond the bundled set

---

### F-26 Type Checking (Steep & RBS)

**Source:** [`types/SteepProvider.ts`](src/types/SteepProvider.ts), [`types/RBSIndex.ts`](src/types/RBSIndex.ts), [`types/RBSHoverProvider.ts`](src/types/RBSHoverProvider.ts), [`types/RBSDefinitionProvider.ts`](src/types/RBSDefinitionProvider.ts)

Integration with [Steep](https://github.com/soutaro/steep) (Ruby type checker) and [RBS](https://github.com/ruby/rbs) (Ruby type signature language).

**Steep integration:**
- **Command:** `RailsForge: Run Steep Type Check` (`railsforge.runSteepCheck`)
- **On-save scanning:** optionally re-run Steep on every save (debounced to 30s)
- Results appear as diagnostics in the Problems panel

**RBS integration:**
- **Hover** over a method/class with an RBS signature → see the type signature
- **Ctrl+Click** on a typed constant → jump to its `.rbs` signature file
- **Command:** `RailsForge: Generate RBS Signatures for File` (`railsforge.generateRBS`) — generates a starter `.rbs` skeleton for the active file
- RBS files are read from the configured signature directory (default: `sig/`)

**Configuration:**

```json
"railsForge.types.steepEnabled": false,
"railsForge.types.steepScanOnSave": false,
"railsForge.types.rbsSigDir": "sig"
```

- `steepEnabled`: enable Steep diagnostics (requires Steep installed in the project)
- `steepScanOnSave`: re-run Steep on save (debounced to 30s)
- `rbsSigDir`: directory (relative to workspace root) where RBS signature files are read from

---

### F-27 Code Analyzers (Reek, Flog, Flay, Debride, Standard)

**Source:** [`lint/RubyAnalyzersProvider.ts`](src/lint/RubyAnalyzersProvider.ts), [`lint/AnalyzerParsers.ts`](src/lint/AnalyzerParsers.ts)

Runs optional Ruby code quality analyzers beyond RuboCop, with findings surfaced in the Problems panel.

**Supported analyzers:**

| Analyzer | What it detects |
|----------|----------------|
| **Reek** | Code smells (duplicate method calls, feature envy, too many statements, etc.) |
| **Flog** | Complexity score per method (higher = more complex) |
| **Flay** | Duplicate/duplicated code blocks across the codebase |
| **Debride** | Unused methods and constants |
| **Standard** | Standard Ruby style enforcement |

**How to use:**
1. Install the analyzer gem(s) in your project: `gem install reek flog flay debride standard`
2. **Command:** `RailsForge: Run Code Analyzers` (`railsforge.runAnalyzers`)
3. Select which analyzers to run (or configure `railsForge.analyzers.enabled`)
4. Findings appear in the Problems panel
5. **Command:** `RailsForge: Clear Code Analyzer Findings` (`railsforge.clearAnalyzers`) — clears all analyzer diagnostics

**Configuration:**

```json
"railsForge.analyzers.enabled": ["reek", "flog"],
"railsForge.analyzers.flogThreshold": 20,
"railsForge.analyzers.paths": ["app", "lib"]
```

- `enabled`: array of analyzer names to run (empty = all installed)
- `flogThreshold`: Flog complexity score at or above which a method is reported (default: 20)
- `paths`: project-relative paths the analyzers scan (default: `["app", "lib"]`)

---

### F-28 Rails Runtime Introspection

**Source:** [`rails/RuntimeIntrospector.ts`](src/rails/RuntimeIntrospector.ts), [`rails/RuntimeIntrospectionService.ts`](src/rails/RuntimeIntrospectionService.ts)

Boots the actual Rails app (via `rails runner`) and reads real runtime metadata: associations, validations, callbacks, routes, and middleware. This catches things static analysis can't — e.g., `has_many` associations defined via concerns, dynamic callbacks, or middleware added by engines.

**How it works:**
1. Runs `rails runner` with a script that introspects `ActiveRecord::Base.descendants`, `Application.routes`, etc.
2. Caches the result in `.railsforge/runtime.json`
3. The cached metadata is used to ground the `@rails` agent and the MCP `get_runtime_introspection` tool
4. Trust- and consent-gated: only runs in trusted workspaces, and only when explicitly invoked or `runtime.introspection.enabled` is true

**How to use:**
- **Command:** `RailsForge: Show Rails Runtime Introspection` (`railsforge.showRuntimeIntrospection`) — displays the cached metadata
- **Command:** `RailsForge: Refresh Rails Runtime Introspection (boots the app)` (`railsforge.refreshRuntimeIntrospection`) — re-boots the app and refreshes the cache
- The `@rails` agent and MCP clients automatically use the cached introspection when available

**Configuration:**

```json
"railsForge.runtime.introspection.enabled": false
```

- Default: `false` (opt-in, since it boots the full Rails app which can take several seconds)

---

### F-29 Provider Layer Architecture

**Source:** [`providers/`](src/providers/) directory (15 modules)

The `src/providers/` layer is the architectural firewall between the VS Code Extension API and RailsForge's core engine. It wraps every `vscode.*` API call behind dedicated Provider classes that consume the `SemanticIndex` and `PatternCatalogAccess` interfaces, keeping the core engine testable without the VS Code runtime.

**Design principle:** No raw `vscode.*` calls in business logic. Every `register*` API is wrapped in a Provider class that consumes the engine via interfaces.

**Provider classes:**

| Provider | VS Code API Surface | Responsibility |
|----------|---------------------|----------------|
| `LanguageIntelligenceProvider` | `vscode.languages.*` | Code actions, hover, code lens, diagnostics, completion, definition, reference, document symbol, rename, formatting, folding range, call hierarchy, inlay hints (18 register* APIs) |
| `TestingApiProvider` | `vscode.tests.*` | Native Test Explorer integration (TestController, TestRunProfile) |
| `AiChatProvider` | `vscode.chat.*`, `vscode.lm.*` | `@rails` chat participant registration + Language Model selection |
| `RefactoringEditProvider` | `vscode.WorkspaceEdit`, `workspace.applyEdit` | Atomic, previewable, undoable multi-file edits |
| `WindowUiProvider` | `vscode.window.*` | Tree views, QuickPick, InputBox, Webview panels, progress, messages |
| `WorkspaceFsProvider` | `vscode.workspace.*` | FileSystemWatcher, configuration, save hooks, multi-root support |
| `SourceControlProvider` | `vscode.scm.*` | AI-assisted Conventional Commit generation (F-22) |
| `TerminalTasksProvider` | `vscode.tasks.*`, `window.createTerminal` | Task discovery + trust-gated terminal automation |
| `PrincipleCodeActionProvider` | `vscode.CodeActionProvider` | Canonical example: consumes `SemanticIndex` + `PatternCatalogAccess`, produces refactoring Quick Fixes |
| `ProviderRegistry` | *(orchestrator)* | Single entry point for `extension.ts`; owns every provider's lifecycle |

**Engine firewall interfaces:**
- `SemanticIndex` — read-only access to the AST/SQLite index, dependency graph, duplicate methods, principle violations
- `PatternCatalogAccess` — read-only access to the pattern catalog and the project's own pattern instances
- `EngineAdapters.ts` — the only file in `src/providers/` that imports concrete engine classes (`PersistentIndexManager`, `PatternCatalog`, `DesignPrincipleLinter`), bridging them to the firewall interfaces

**Semantic token types (contribution point):**
RailsForge registers 10 custom semantic token types for Rails-specific syntax highlighting:
- `rails-association`, `rails-callback`, `rails-validation`, `rails-scope`, `rails-route-helper`, `rails-migration-method`, `rails-stimulus-target`, `rails-view-helper`, `rails-policy-method`, `rails-service-entrypoint`

Plus 4 token modifiers: `deprecated`, `internal`, `readonly`, `cached`

---

## 5. Keybindings Reference

| Action | Linux / Windows | macOS | Command ID |
| :--- | :--- | :--- | :--- |
| Go to Model | `Alt+R M` | `Cmd+Alt+R M` | `railsforge.goToModel` |
| Go to Controller | `Alt+R C` | `Cmd+Alt+R C` | `railsforge.goToController` |
| Go to View | `Alt+R V` | `Cmd+Alt+R V` | `railsforge.goToView` |
| Go to Spec / Test | `Alt+R S` | `Cmd+Alt+R S` | `railsforge.goToSpec` |
| Search Routes | `Alt+R R` | `Cmd+Alt+R R` | `railsforge.searchRoutes` |
| Open DevDocs | `Alt+R D` | `Cmd+Alt+R D` | `railsforge.openDevDocs` |
| Evaluate Selection in REPL | `Alt+R E` | `Cmd+Alt+R E` | `railsforge.evaluateInREPL` |

> **Note:** `Go to Policy` (`Alt+R P`) is listed in the F-02 feature reference but is not bound by default in `package.json` keybindings — it's available via the Command Palette and shows up when Pundit/CanCanCan is detected in `Gemfile.lock`.

All keybindings require `editorTextFocus` (except Route Search, DevDocs, and REPL evaluation which are global).

---

## 6. Command Palette Reference

### Architecture & Refactoring

| Command Title | Command ID |
| :--- | :--- |
| Scan Workspace for Patterns, Smells & Safety | `railsforge.scanWorkspaceArchitecture` |
| Refactor Selection (Design Patterns) | `railsforge.refactorSelection` |
| Extract Selection to Service Object | `railsforge.extractService` |
| Extract Selection to Query Object | `railsforge.extractQuery` |
| Generate New Service Object | `railsforge.generateServiceObject` |
| Clone Existing Pattern | `railsforge.clonePattern` |
| Fix All Deterministic Principle Violations in File | `railsforge.fixAllInFile` |
| Show Similar Patterns in This Project | `railsforge.showSimilarPatterns` |
| Show Related Files (Services, Queries, Policies, Specs) | `railsforge.showRelatedFiles` |
| Optimize Rails Workspace Performance | `railsforge.optimizeWorkspacePerformance` |

### Navigation

| Command Title | Command ID |
| :--- | :--- |
| Go to Matching Model | `railsforge.goToModel` |
| Go to Matching Controller | `railsforge.goToController` |
| Go to Matching View | `railsforge.goToView` |
| Go to Spec / Test | `railsforge.goToSpec` |
| Go to Pundit / CanCanCan Policy | `railsforge.goToPolicy` |
| Go to ViewComponent | `railsforge.goToComponent` |
| Search Rails Routes | `railsforge.searchRoutes` |
| Peek Model Schema | `railsforge.showSchemaPeek` |
| Open Design Pattern Explanation | `railsforge.openPattern` |
| Explain Pattern in Chat | `railsforge.explainPattern` |

### Static Analysis & Security

| Command Title | Command ID |
| :--- | :--- |
| RuboCop Autocorrect File | `railsforge.rubocopAutocorrect` |
| Apply Community RuboCop Style Guide (Shopify/GitLab/Airbnb) | `railsforge.applyRubocopStyleGuide` |
| Run Brakeman Security Scan | `railsforge.runBrakeman` |
| Run Gemfile.lock Security Audit (bundle-audit) | `railsforge.runBundleAudit` |
| Run Code Analyzers (Reek, Flog, Flay, Debride, Standard) | `railsforge.runAnalyzers` |
| Clear Code Analyzer Findings | `railsforge.clearAnalyzers` |
| Check Migration Safety (Strong Migrations) | `railsforge.analyzeMigration` |
| Run Steep Type Check | `railsforge.runSteepCheck` |
| Generate RBS Signatures for File | `railsforge.generateRBS` |

### Search & Dependencies

| Command Title | Command ID |
| :--- | :--- |
| Semantic Search (find similar code by meaning) | `railsforge.semanticSearch` |
| Find Near-Duplicate Methods (DRY) | `railsforge.findDuplicateMethods` |
| Show Circular Dependencies | `railsforge.showDependencyCycles` |

### Rails Generators & Console

| Command Title | Command ID |
| :--- | :--- |
| Rails Generate... | `railsforge.generate` |
| Rails Destroy... | `railsforge.destroyGenerated` |
| Open Console (Pry/IRB/Rails) | `railsforge.openRailsConsole` |
| Evaluate Selection in REPL | `railsforge.evaluateInREPL` |
| Refresh Rake Tasks | `railsforge.refreshRakeTasks` |

### Documentation

| Command Title | Command ID |
| :--- | :--- |
| Open DevDocs | `railsforge.openDevDocs` |
| Open Gem Documentation | `railsforge.openRubyDoc` |
| Update Offline DevDocs Cache | `railsforge.updateDevDocs` |
| Open Project Overview (routes, schema, runtime, toolchain) | `railsforge.openVirtualDoc` |

### Runtime Introspection

| Command Title | Command ID |
| :--- | :--- |
| Show Rails Runtime Introspection | `railsforge.showRuntimeIntrospection` |
| Refresh Rails Runtime Introspection (boots the app) | `railsforge.refreshRuntimeIntrospection` |

### AI & MCP

| Command Title | Command ID |
| :--- | :--- |
| Generate Conventional Commit | `railsforge.generateAiCommit` |
| Export Cursor Rules & Register MCP Server | `railsforge.exportCursorRules` |
| Copy System Prompt for Cline / Continue / Claude Dev | `railsforge.copySystemPrompt` |
| Apply Chat Response (diff/create/replace) | `railsforge.applyChatResponse` |
| Set AI Provider API Key | `railsforge.setAiApiKey` |

### Environment & Diagnostics

| Command Title | Command ID |
| :--- | :--- |
| Diagnose Environment | `railsforge.diagnoseEnvironment` |
| Show Output Logs | `railsforge.showLogs` |

### Gem Publishing (gem projects only)

| Command Title | Command ID |
| :--- | :--- |
| Bump Gem Version | `railsforge.bumpGemVersion` |
| Release Gem (`bundle exec rake release`) | `railsforge.releaseGem` |

### API Documentation

| Command Title | Command ID |
| :--- | :--- |
| Generate OpenAPI Skeleton | `railsforge.generateApiDocs` |

Several commands only appear in the Command Palette for the relevant project type or configuration (see the settings table below and `package.json`'s `menus.commandPalette`) — e.g. `goToModel`/`goToController`/`searchRoutes`/`runBrakeman`/`analyzeMigration`/`showSchemaPeek`/`extractQuery` only show for Rails apps (`monolith`/`api_only`), `goToView` only for `monolith`, `generateApiDocs` only when `apiDocs.enabled` is true, `bumpGemVersion`/`releaseGem` only for `gem`, `setAiApiKey` only when `ai.provider` isn't `"ollama"`, and `goToPolicy`/`goToComponent` only when Pundit/ViewComponent are detected in `Gemfile.lock`. Every command still runs fine if invoked another way (e.g. a keybinding) regardless of this filtering — it only affects Command Palette clutter.

---

## 7. Configuration Reference

All settings live under the `railsForge.*` namespace and can be set at either the **user level** (global `settings.json`, applies to every workspace) or the **workspace level** (`.vscode/settings.json`, applies to just that project — VS Code's normal precedence rules apply, workspace wins). None of RailsForge's settings use a restricted scope, so every one of them is configurable at both levels with no special setup.

Settings marked **"requires reload"** are read once at activation (or when a provider/watcher is constructed) rather than watched live; change them, then run **Developer: Reload Window**. Everything else takes effect on the very next action (next save, next scan, next command run) with no reload needed.

### Workspace & Project Detection

| Setting | Type | Default | Reload? | Description |
| :--- | :--- | :--- | :--- | :--- |
| `railsForge.excludePatterns` | `string[]` | see below | Live for scans; existing watchers need reload | Glob patterns excluded from every workspace scan. Default: `node_modules`, `vendor`, `tmp`, `log`, `.git`, `coverage`, `public/assets`, `public/packs` |
| `railsForge.projectType.override` | `"auto"` \| `"monolith"` \| `"api_only"` \| `"gem"` \| `"script"` | `"auto"` | **Requires reload** | Forces a project type over auto-detection. Controls which commands/keybindings the Command Palette shows |
| `railsForge.ruby.versionManager` | `"auto"` \| `"mise"` \| `"asdf"` \| `"rbenv"` \| `"rvm"` \| `"chruby"` | `"auto"` | **Requires reload** | Version manager used to run project tools (RuboCop, Rails, RSpec, Brakeman, ...). `auto` = detect from environment |
| `railsForge.performance.autoOptimizeWorkspace` | `"auto"` \| `"off"` \| `"on"` | `"auto"` | Live | How RailsForge optimizes VS Code performance (file watcher and search exclusions) for large Rails workspaces |
| `railsForge.log.level` | `"debug"` \| `"info"` \| `"warn"` \| `"error"` | `"info"` | Live | Verbosity of the RailsForge output channel (View → Output → RailsForge) |
| `railsForge.log.file` | `boolean` | `false` | Live | Mirror every log line to `<workspace>/.railsforge/railsforge.log` |

### Schema & Routes Indexing

| Setting | Type | Default | Reload? | Description |
| :--- | :--- | :--- | :--- | :--- |
| `railsForge.schema.autoIndex` | `boolean` | `true` | **Requires reload** | Auto-rebuild schema index when `db/schema.rb` changes |
| `railsForge.routes.autoIndex` | `boolean` | `true` | **Requires reload** | Auto-rebuild route index when `config/routes.rb` changes |

### Linting & Security

| Setting | Type | Default | Reload? | Description |
| :--- | :--- | :--- | :--- | :--- |
| `railsForge.rubocop.autocorrectOnSave` | `boolean` | `false` | Live | Run RuboCop autocorrect (mode per `rubocop.mode`) on every Ruby file save |
| `railsForge.rubocop.mode` | `"safe"` \| `"unsafe"` | `"safe"` | Live | RuboCop autocorrect mode: `-a` (safe) or `-A` (unsafe) |
| `railsForge.brakeman.scanOnSave` | `boolean` | `false` | Live | Run a Brakeman scan in the background on save (Rails only), debounced to at most once per 30s |
| `railsForge.analyzers.enabled` | `string[]` | `[]` | Live | Analyzers run by "Run Code Analyzers" (empty = all installed). Options: `reek`, `flog`, `flay`, `debride`, `standard` |
| `railsForge.analyzers.flogThreshold` | `number` | `20` | Live | Flog complexity score at or above which a method is reported |
| `railsForge.analyzers.paths` | `string[]` | `["app","lib"]` | Live | Project-relative paths the analyzers scan |

### Type Checking (Steep & RBS)

| Setting | Type | Default | Reload? | Description |
| :--- | :--- | :--- | :--- | :--- |
| `railsForge.types.steepEnabled` | `boolean` | `false` | **Requires reload** | Enable Steep type-checker diagnostics (requires Steep installed in the project) |
| `railsForge.types.steepScanOnSave` | `boolean` | `false` | Live | Re-run Steep in the background on Ruby file save when `steepEnabled` is true (debounced to 30s) |
| `railsForge.types.rbsSigDir` | `string` | `"sig"` | **Requires reload** | Directory (relative to workspace root) RBS signature files are read from |

### Testing

| Setting | Type | Default | Reload? | Description |
| :--- | :--- | :--- | :--- | :--- |
| `railsForge.testing.framework` | `"rspec"` \| `"minitest"` | `"rspec"` | Live | Tie-breaker for Run/Debug Test when a test file's path doesn't say `spec/` or `test/` |

### Runtime Introspection

| Setting | Type | Default | Reload? | Description |
| :--- | :--- | :--- | :--- | :--- |
| `railsForge.runtime.introspection.enabled` | `boolean` | `false` | **Requires reload** | Enable Rails runtime introspection via `rails runner`. Opt-in — boots the full Rails app which can take several seconds |

### AI Provider

| Setting | Type | Default | Reload? | Description |
| :--- | :--- | :--- | :--- | :--- |
| `railsForge.ai.provider` | `"ollama"` \| `"openai"` \| `"anthropic"` \| `"vscode-lm"` | `"ollama"` | **Requires reload** | Backend for the `@rails` agent. Cloud providers send prompts/code to that provider's API. `vscode-lm` uses VS Code's model picker (Copilot or any Language Model provider) — no API key stored by RailsForge |
| `railsForge.ai.vscodeLm.family` | `string` | `""` | **Requires reload** | Preferred model family (e.g. `gpt-4o`, `claude-sonnet`) when `ai.provider` is `"vscode-lm"` |
| `railsForge.ai.openai.model` | `string` | `"gpt-4o-mini"` | **Requires reload** | Model used when `ai.provider` is `"openai"` |
| `railsForge.ai.openai.baseUrl` | `string` | `"https://api.openai.com"` | **Requires reload** | Base URL for OpenAI-compatible endpoints (OpenRouter, self-hosted vLLM). The agent appends `/v1/chat/completions` |
| `railsForge.ai.anthropic.model` | `string` | `"claude-sonnet-4-5"` | **Requires reload** | Model used when `ai.provider` is `"anthropic"` |
| `railsForge.ai.temperature` | `number` | `0.2` | **Requires reload** | Sampling temperature for every provider. 0.2 keeps AI fixes deterministic; raise toward 1.0 for more creative chat |
| `railsForge.ai.maxTokens` | `number` | `2048` | **Requires reload** | Max generated tokens per response (`num_predict` on Ollama, `max_tokens` on cloud) |
| `railsForge.ai.timeoutMs` | `number` | `120000` | **Requires reload** | Per-request timeout for `@rails` agent calls |

### Ollama Settings (Ollama provider only)

| Setting | Type | Default | Reload? | Description |
| :--- | :--- | :--- | :--- | :--- |
| `railsForge.ollama.host` | `string` | `"http://localhost:11434"` | **Requires reload** | URL of the local Ollama instance |
| `railsForge.ollama.model` | `string` | `"qwen2.5-coder:14b"` | **Requires reload** | Default chat model for `@rails` AI agent when `ai.provider` is `"ollama"` |
| `railsForge.ollama.embeddingModel` | `string` | `"nomic-embed-text"` | Live | Embedding model for Semantic Search (pull separately: `ollama pull nomic-embed-text`) |
| `railsForge.ollama.numCtx` | `number` | `8192` | **Requires reload** | Ollama context window (`num_ctx`). 8192 fits prompt + diff instructions |
| `railsForge.ollama.keepAlive` | `string` | `"30m"` | **Requires reload** | How long the Ollama model stays loaded after a request (`keep_alive`) |
| `railsForge.ollama.repeatPenalty` | `number` | `1.15` | **Requires reload** | Ollama repeat penalty — suppresses repetition loops in small local models (1.0 disables) |
| `railsForge.ollama.minP` | `number` | `0.05` | **Requires reload** | Ollama min_p filter — keeps high-probability tokens, drops noise |

### Agent & Skills

| Setting | Type | Default | Reload? | Description |
| :--- | :--- | :--- | :--- | :--- |
| `railsForge.agent.toolLoop` | `boolean` | `true` | Live | Enable the autonomous tool-use loop for the `@rails` agent (F-24) |
| `railsForge.agent.maxToolSteps` | `number` | `3` | Live | Maximum tool iterations before the agent stops (prevents infinite loops) |
| `railsForge.agent.verifyRubySyntax` | `boolean` | `true` | Live | Run `ruby -c` on generated code before applying it (catches syntax errors early) |
| `railsForge.skills.enabled` | `boolean` | `true` | **Requires reload** | Route each AI request to the most relevant ruby-agent-skills (bundled, pinned) |
| `railsForge.skills.maxPerRequest` | `number` | `4` | Live | Maximum domain skills injected per request (cross-cutting skills like `ruby-clean-code` are always included) |
| `railsForge.skills.extraPaths` | `string[]` | `[]` | **Requires reload** | Additional skill directories to load beyond the bundled set |
| `railsForge.legal.skills.enabled` | `boolean` | `false` | **Requires reload** | Enable legal-domain AI guardrails inspired by the lawve-ai/awesome-legal-skills collection |

### MCP & API Docs

| Setting | Type | Default | Reload? | Description |
| :--- | :--- | :--- | :--- | :--- |
| `railsForge.mcp.enabled` | `boolean` | `true` | Live | Whether "Export Cursor Rules" also registers the MCP server in `.cursor/mcp.json` |
| `railsForge.apiDocs.enabled` | `boolean` | `true` | Live (Command Palette visibility needs reload) | Whether "Generate OpenAPI Skeleton" is available |

### Documentation Hovers (APIDock, DevDocs, RubyDoc)

| Setting | Type | Default | Reload? | Description |
| :--- | :--- | :--- | :--- | :--- |
| `railsForge.apidock.enabled` | `boolean` | `true` | Live | Append apidock.com's top-rated community note to Rails DSL hovers |
| `railsForge.apidock.baseUrl` | `string` | `"https://apidock.com"` | **Requires reload** | Base URL for apidock.com lookups. Override to point at a mirror |
| `railsForge.apidock.requestTimeoutMs` | `number` | `5000` | Live | Timeout for an apidock.com hover lookup, in milliseconds |
| `railsForge.apidock.cacheTtlHours` | `number` | `24` | Live | How long a fetched APIDock note is cached before re-fetching, in hours |
| `railsForge.apidock.customMappings` | `array` | `[]` | Live | Extra/overriding entries for the hovered-word → apidock.com Class/method lookup |
| `railsForge.devdocs.baseUrl` | `string` | `"https://devdocs.io"` | **Requires reload** | Base URL loaded by "Open DevDocs" |
| `railsForge.devdocs.openBesideActiveEditor` | `boolean` | `true` | Live | Open the DevDocs panel beside the active editor (false = same column) |
| `railsForge.devdocs.offlineEnabled` | `boolean` | `true` | **Requires reload** | Download the project's Ruby/Rails DevDocs docsets to `.railsforge/devdocs/` |
| `railsForge.devdocs.dataBaseUrl` | `string` | `"https://documents.devdocs.io"` | **Requires reload** | Base URL DevDocs docset data is downloaded from |
| `railsForge.devdocs.fetchTimeoutMs` | `number` | `30000` | Live | Timeout for downloading a DevDocs docset file, in milliseconds |
| `railsForge.devdocs.rubySlug` | `string` | `""` | Live | DevDocs docset slug for offline Ruby core docs, e.g. `ruby~3.3`. Empty = auto-detect |
| `railsForge.devdocs.railsSlug` | `string` | `""` | Live | DevDocs docset slug for offline Rails docs, e.g. `rails~7.1`. Empty = auto-detect |
| `railsForge.rubydoc.enabled` | `boolean` | `true` | Live | Whether "Open Gem Documentation" and the `get_gem_documentation` MCP tool are available |
| `railsForge.rubydoc.baseUrl` | `string` | `"https://www.rubydoc.info"` | **Requires reload** | Base URL for rubydoc.info gem documentation lookups |
| `railsForge.rubydoc.requestTimeoutMs` | `number` | `6000` | Live | Timeout for a rubydoc.info lookup, in milliseconds |
| `railsForge.rubydoc.cacheTtlDays` | `number` | `7` | Live | How long a fetched gem doc entry is cached before re-fetching, in days |
| `railsForge.rubydoc.namespaceMappings` | `array` | `[]` | Live | Extra/overriding entries for the constant-namespace → gem-name lookup |

### Performance

| Setting | Type | Default | Reload? | Description |
| :--- | :--- | :--- | :--- | :--- |
| `railsForge.performance.cacheSize` | `number` | `200` | **Requires reload** | Max entries in RailsForge's bounded caches (Gem Lens, semantic-search embeddings) before LRU eviction |

**Cloud AI API keys** are never stored in `settings.json` — run **RailsForge: Set AI Provider API Key** (after setting `railsForge.ai.provider` to `"openai"` or `"anthropic"`) and the key is stored in VS Code's encrypted `SecretStorage`, scoped per provider.

**API key security note:** switching `railsForge.ai.provider` to a cloud provider means your prompts — which include file content, schema, and routes for grounding — are sent to that provider's API. Stick with `"ollama"` (the default) to keep everything local.

---

## 8. Architecture Overview

```
Extension Host (extension.ts)
│
├── Provider Layer (src/providers/ — VS Code API firewall)
│   ├── ProviderRegistry           ← single entry point; owns lifecycle
│   ├── LanguageIntelligenceProvider  ← wraps vscode.languages.* (18 APIs)
│   ├── WorkspaceFsProvider        ← wraps vscode.workspace.* (watchers, config, save)
│   ├── WindowUiProvider           ← wraps vscode.window.* (tree views, QuickPick, webviews)
│   ├── TerminalTasksProvider      ← wraps vscode.tasks.* + createTerminal (trust-gated)
│   ├── TestingApiProvider         ← wraps vscode.tests.*
│   ├── AiChatProvider             ← wraps vscode.chat.* + vscode.lm.*
│   ├── SourceControlProvider      ← wraps vscode.scm.* (Conventional Commits)
│   ├── RefactoringEditProvider    ← wraps vscode.WorkspaceEdit + applyEdit
│   ├── PrincipleCodeActionProvider ← canonical example (consumes SemanticIndex)
│   ├── ConventionalCommitGenerator ← pure-function diff analysis
│   ├── SemanticIndex              ← engine firewall interface (no vscode import)
│   ├── PatternCatalogAccess       ← engine firewall interface
│   └── EngineAdapters             ← bridges PersistentIndexManager / PatternCatalog
│                                    / DesignPrincipleLinter to the interfaces
│
├── Workspace Trust (F-23)
│   ├── Trust                     ← isWorkspaceTrusted() / assertTrusted()
│   ├── ProjectTerminal           ← trust-gated createTerminal / sendText
│   └── ProjectProcess            ← trust-gated child_process (execFile / spawn)
│
├── Rails Intelligence
│   ├── SchemaIndexer             ← parses db/schema.rb
│   ├── RoutesIndexer             ← parses config/routes.rb
│   ├── MVCNavigator              ← Alt+R keybindings
│   ├── ViewPartialResolver       ← Ctrl+Click on render
│   ├── ViewPartialDefinitionProvider
│   ├── ViewComponentResolver     ← ViewComponent jump
│   ├── RuntimeIntrospector       ← rails runner introspection (F-28)
│   └── RuntimeIntrospectionService
│
├── Hotwire
│   ├── StimulusIndexer           ← app/javascript/controllers/
│   ├── StimulusCompletionProvider
│   ├── StimulusDefinitionProvider ← Ctrl+Click data-controller/data-action
│   ├── TurboFrameNavigator
│   └── TurboFrameDefinitionProvider ← Ctrl+Click turbo_frame_tag / turbo-frame
│
├── Lint & Security
│   ├── RuboCopProvider           ← live diagnostics + quick fixes
│   ├── BrakemanProvider          ← on-demand / on-save scan
│   ├── BundlerAuditScanner       ← CVE check on Gemfile.lock
│   ├── RailsDeprecationLinter
│   └── RubyAnalyzersProvider     ← Reek, Flog, Flay, Debride, Standard (F-27)
│
├── Type Checking (F-26)
│   ├── SteepProvider             ← Steep type checker integration
│   ├── RBSIndex                  ← RBS signature index
│   ├── RBSHoverProvider          ← RBS hover tooltips
│   └── RBSDefinitionProvider     ← Ctrl+Click to .rbs files
│
├── Principles & Patterns
│   ├── DesignPrincipleLinter     ← SOLID/DRY/KISS/YAGNI/Demeter
│   ├── ProjectPatternIndexer     ← living pattern catalog
│   └── PatternCodeLensProvider
│
├── Refactoring
│   ├── ServiceExtractor          ← atomic WorkspaceEdit
│   ├── QueryExtractor
│   ├── FormObjectExtractor
│   ├── ValueObjectExtractor
│   ├── DuplicateCallSiteFinder
│   └── SpecFileGenerator
│
├── Graph & Relations
│   ├── MinimalDependencyGraph    ← regex-based collaborator graph
│   ├── RelatedFilesIndex
│   ├── RelatedCodeLensProvider
│   ├── RelatedHoverProvider
│   └── Freshness                 ← graph provenance tracking
│
├── Testing
│   ├── TestExplorerController    ← VS Code Test API
│   ├── TestCodeLensProvider      ← ▶ Run / 🐞 Debug
│   └── FactoryBotResolver
│
├── Search
│   ├── EmbeddingClient           ← Ollama /api/embeddings
│   └── SemanticSearchIndex       ← cosine similarity + keyword fallback
│
├── AST Index (Worker Thread)
│   ├── indexer.worker.ts         ← off-thread parsing + SQLite writes
│   ├── RubyAstParser             ← tree-sitter-ruby
│   ├── PersistentIndexer         ← better-sqlite3 (NAPI 10+ only)
│   ├── DuplicateMethodDetector
│   └── PersistentDependencyGraph
│
├── AI Agent (F-15, F-24)
│   ├── RailsAgent                ← Ollama/OpenAI/Anthropic/vscode-lm chat client
│   ├── RailsRAGContext           ← prompt grounding builder
│   ├── RailsChatParticipant      ← @rails VS Code Chat
│   ├── AgentLoop                 ← autonomous tool-use loop
│   ├── LoopTools                 ← tool definitions for the agent
│   ├── SpeculativeFixCache       ← pre-generates fixes for common offenses
│   └── RubySyntax                ← ruby -c syntax verification
│
├── Skills (F-25)
│   ├── SkillRouter               ← routes AI request to relevant skills
│   ├── SkillContextBuilder       ← builds skill context for the prompt
│   ├── SkillCatalog              ← bundled skill metadata
│   ├── SkillRegistry             ← skill loading + caching
│   └── SafetyRules               ← destructive-command / SQL injection warnings
│
├── MCP Server (dist/mcp/server.js — separate process)
│   └── Exposes 7 tools via stdio MCP protocol
│       (get_schema, list_routes, list_patterns, find_similar_pattern,
│        get_dependencies, find_duplicate_methods, get_runtime_introspection)
│
├── Editing Aids
│   ├── EndwiseProvider           ← auto-`end` on Enter
│   ├── ErbTagCompletionProvider  ← `<%` tag expansion
│   ├── GemLensProvider           ← Gemfile hover
│   └── RubyGemsClient            ← rubygems.org API, LRU cache
│
├── Config & Project-Type Tooling
│   ├── RailsForgeConfig          ← single read point for every railsForge.* setting
│   ├── EnvironmentDetector       ← + projectType detection/override
│   ├── OpenApiSkeletonGenerator  ← Generate OpenAPI Skeleton
│   ├── GemVersionBumper          ← Bump Gem Version
│   └── LruCache                  ← generic bounded cache (Gem Lens, Semantic Search)
│
├── Diagnostics
│   ├── Diagnostics               ← unified diagnostic collection
│   └── collect                   ← diagnostic collection helpers
│
└── Views (Activity Bar)
    ├── RailsArchitectureTreeProvider
    ├── PatternCatalogTreeProvider
    └── VirtualDocsProvider        ← railsforge:/ virtual documents
```

---

## 9. Relationship to Ruby LSP

RailsForge is a **companion** to Shopify's `ruby-lsp` — not a replacement.

```json
// .vscode/extensions.json
{ "recommendations": ["shopify.ruby-lsp", "ShubhamTaywade.railsforge"] }
```

| Responsibility | Tool |
| :--- | :--- |
| Ruby syntax, diagnostics, go-to-definition | `shopify.ruby-lsp` + `ruby-lsp-rails` |
| Schema peek, route search, pattern catalog | **RailsForge** |
| SOLID/DRY principle enforcement | **RailsForge** |
| Security scans (Brakeman, bundle-audit) | **RailsForge** |
| Local AI agent grounded in project | **RailsForge** |
| MCP server exposing project context | **RailsForge** |

**Optional deeper integration:** RailsForge ships a companion Ruby gem (`ruby-lsp-addon/`) — a `RubyLsp::Addon` that injects schema-aware hover into `ruby-lsp`'s own hover responses. See [`ruby-lsp-addon/README.md`](ruby-lsp-addon/README.md).

---

## 10. Implementation Status

| Phase | Feature | Status |
| :--- | :--- | :--- |
| 1 | Foundation & build pipeline | ✅ Done |
| 2 | Schema/Routes indexing, MVC Navigator | ✅ Done |
| 3 | RuboCop, Brakeman, Rails Best Practices | ✅ Done |
| 4 | Service/Query/Form extractors | ✅ Done |
| 5 | RSpec/Minitest runner, FactoryBot | ✅ Done |
| 6 | `@rails` Chat Participant, Ollama, Self-repair loop | ✅ Done |
| 7 | VSIX packaging (webpack, CopyPlugin, pnpm layout) | ✅ Done |
| 8 | DuplicateMethodDetector (Jaccard similarity) | ✅ Done |
| 9 | RelatedFilesIndex, RelatedCodeLensProvider | ✅ Done |
| 10 | SemanticSearchIndex (Ollama embeddings + keyword fallback) | ✅ Done |
| 11 | PersistentDependencyGraph (DFS cycle detection) | ✅ Done |
| 12 | AST index (tree-sitter + SQLite, worker thread) | ✅ Done |
| 13 | DuplicateCallSiteFinder + SpecFileGenerator | ✅ Done |
| 14 | MCP server + Cursor Rules export | ✅ Done |
| 15 | Stimulus ↔ TypeScript `Cmd+Click` cross-linking, Turbo Frame & partial `Ctrl+Click` navigation | ✅ Done |
| 16 | Endwise auto-`end`, ERB tag-expansion, Gem Lens hover | ✅ Done |
| 17 | Project-type detection (monolith/api_only/gem/script) | ✅ Done |
| 18 | Full settings.json configurability: excludePatterns, project-type override + Command Palette gating, cloud AI providers, MCP toggle, API doc generator, gem publishing, bounded LRU caches | ✅ Done |
| 19 | Restricted Mode / Workspace Trust gate: trust-gated wrappers for terminals, child_process, debug sessions, task execution; TrustGuard static analysis test enforces no bypasses | ✅ Done |
| 20 | Agent tool loop with self-repair: autonomous tool-use (`AgentLoop`, `LoopTools`), `ruby -c` syntax verification between steps, configurable `maxToolSteps` | ✅ Done |
| 21 | Skill routing & safety rules: `route_skills` MCP/LM tool, safety-forced rules for destructive commands / SQL injection / mass assignment / risky migrations | ✅ Done |
| 22 | Compatibility & mutation testing: per-file v8 coverage floors, Stryker mutation testing, restricted-host test suite, compatibility table verified by `test/Compatibility.test.ts` | ✅ Done |
| 23 | Provider layer architecture (F-29): `src/providers/` firewall with 10 Provider classes wrapping every VS Code API domain; `SemanticIndex` + `PatternCatalogAccess` interfaces decouple engine from VS Code; all FileSystemWatchers, save hooks, tree views, chat participant, test explorer, task provider, and SCM migrated to the provider layer | ✅ Done |
| 24 | AI-assisted Conventional Commits (F-22): `ConventionalCommitGenerator` pure-function diff analyzer, `SourceControlProvider` hooks into built-in Git extension's input box, `generateAiCommit` command + SCM menu entries | ✅ Done |
| 25 | Semantic token types: 10 Rails-specific token types (`rails-association`, `rails-callback`, `rails-validation`, `rails-scope`, `rails-route-helper`, `rails-migration-method`, `rails-stimulus-target`, `rails-view-helper`, `rails-policy-method`, `rails-service-entrypoint`) + 4 token modifiers (`deprecated`, `internal`, `readonly`, `cached`) | ✅ Done |

**Package:** `railsforge.vsix` (~11 MB) — verified end-to-end with `vsce package --no-dependencies`.

**Testing:** 702 unit tests (vite), host tests (`@vscode/test-electron`), restricted-mode tests, compatibility tests, and mutation tests (Stryker). Per-file v8 coverage floors enforced via `pnpm run coverage`.
