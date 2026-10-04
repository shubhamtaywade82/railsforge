# Product Requirements Document (PRD)
## RailsForge / Ruby & Rails Supercharged All-in-One Extension

- **Project Name:** `ruby-rails-extension` (RailsForge)
- **Target Platforms:** VS Code, Cursor IDE, VSCodium, Windsurf
- **Primary Languages:** TypeScript (Extension Host), Ruby (LSP & Language Tools)
- **Author/Owner:** Shubham Taywade
- **Status:** Approved / In Development

---

## 1. Executive Summary & Vision

Developers working with **Ruby and Ruby on Rails** currently suffer from fragmented toolchains. A typical developer must install 6 to 10 separate extensions:
1. A base Ruby LSP (Shopify `ruby-lsp` or `solargraph`)
2. A separate Rails navigation extension (`rails-go-to-spec`, `rails-navigation`)
3. A RuboCop extension (`ruby-rubocop` or `rubocop-lsp`)
4. A view helper extension (`vscode-erb`, `haml`, `slim`)
5. A testing runner (`vscode-rtest`, `vscode-jest-runner`)
6. A security scanner (`brakeman`)
7. An AI coding helper with zero intrinsic Rails schema/route context.

**RailsForge** is the unified, all-in-one developer platform for **Ruby and Ruby on Rails**. It combines deep language intelligence, full-stack Rails context (Schema, Routes, Associations, Views, Migrations), automated static analysis (RuboCop, Rails Best Practices, RubyCritic, Brakeman), architectural refactoring assistants, and a local AI Agent (`@rails`) grounded in the active application's database schema, route tables, and conventions.

---

## 2. Core Pillars & Architecture

```mermaid
graph TD
    User([Developer in VS Code / Cursor]) --> Ext[RailsForge Extension Host]
    
    subgraph Language_Core [1. Language & LSP Engine]
        Ext --> RubyLSP[Ruby LSP / Prism AST Parser]
        Ext --> Solargraph[Solargraph Adapter]
        Ext --> Sorbet[Sorbet / Steep Typing]
    end
    
    subgraph Rails_Intelligence [2. Rails Ecosystem Intelligence]
        Ext --> MVCSwitcher[Fast MVC & File Switcher]
        Ext --> RouteResolver[Routes & URL Helper Resolver]
        Ext --> SchemaExplorer[Schema Peek & Association Engine]
        Ext --> ViewNavigator[Partial & View Definition Jump]
    end
    
    subgraph Quality_Security [3. Static Analysis & Security]
        Ext --> RuboCopEngine[RuboCop / RuboCop-Rails LSP]
        Ext --> BestPractices[Rails Best Practices Engine]
        Ext --> RubyCritic[RubyCritic / Complexity Profiler]
        Ext --> BrakemanEngine[Brakeman Security Scanner]
    end
    
    subgraph Refactoring_Engine [4. Architecture & Refactoring]
        Ext --> ExtractService[Extract Service / Query / Form Object]
        Ext --> NPlusOne[N+1 Query & Perf Detector]
        Ext --> SOLIDAdvisor[SOLID Design Principles Advisor]
    end
    
    subgraph Testing_Ecosystem [5. Testing & Debugging]
        Ext --> RSpecRunner[RSpec / Minitest Live Runner]
        Ext --> FactoryBotIntelli[FactoryBot & Fixture Resolver]
        Ext --> RDBG[Ruby Debugger: rdbg / pry]
    end
    
    subgraph AIAgent [6. Local AI Agent & Ollama]
        Ext --> RailsChatParticipant[Chat: @rails & Slash Commands]
        Ext --> OllamaClient[Local Ollama / LLM Backend]
        Ext --> SelfRepairLoop[Test & Lint Self-Repair Loop]
    end
```

---

## 3. Detailed Functional Requirements

### 3.1 Pillar 1: Language Server & IntelliSense (LSP)
- **Universal Engine Support:** Automatic detection and seamless bridging with `ruby-lsp` (Shopify's modern Prism-based parser) or `solargraph` with graceful fallbacks.
- **Symbol Indexing & Hover:** Instant hover documentation for standard library classes, gems, Rails classes, and user code.
- **Smart Autocomplete:** Context-aware completion for constants, instance methods, class methods, block parameters, and keyword arguments.
- **Document Outline & Breadcrumbs:** Fast AST parsing displaying classes, modules, methods, callbacks, and DSL blocks.
- **Go to Definition & Find References:** Precision symbol navigation across files and installed bundler gems (`bundle open` equivalent inside editor).

### 3.2 Pillar 2: Rails Ecosystem Superpowers
- **Instant MVC & Companion Switcher (`Alt+R` / `Cmd+Alt+R`):**
  - Model $\leftrightarrow$ Controller $\leftrightarrow$ Views (index, show, form) $\leftrightarrow$ Helper $\leftrightarrow$ Spec/Test $\leftrightarrow$ Serializer $\leftrightarrow$ Policy $\leftrightarrow$ Service $\leftrightarrow$ Migration.
- **Route Navigation & Auto-completion:**
  - Index `config/routes.rb` in real time.
  - Autocomplete named route helpers (`users_path`, `edit_order_url`, `api_v1_products_path`).
  - Hover over route helpers to see HTTP method, URL pattern, and controller#action mapping.
  - Peek/Jump from route helper directly to the controller action.
- **Schema & Database Intelligence:**
  - Parse `db/schema.rb` or `db/structure.sql` into an in-memory index.
  - Auto-complete model column names on ActiveRecord queries (e.g. `User.where(em...)` $\to$ `email:`).
  - Inline Schema Peek: Hover over any Model class or instance variable to view table columns, types, nullability, and default values.
  - Association resolution: Auto-complete `has_many`, `belongs_to`, `has_one`, `has_and_belongs_to_many`, validating foreign keys and model existence.
- **View & Partial Navigation:**
  - `render "shared/navbar"` $\to$ `Ctrl+Click` jumps directly to `app/views/shared/_navbar.html.erb` (supporting `.erb`, `.haml`, `.slim`).
  - View component support: Peek and jump to `app/components/` classes and template files.

### 3.3 Pillar 3: Quality, Static Analysis & Security
- **RuboCop & RuboCop-Rails Real-time Engine:**
  - Fast background linting using project-local `.rubocop.yml`.
  - Inline code action lightbulbs with 1-click fixes.
  - **Quick Fix Actions:**
    - `RuboCop: Auto-correct this offense` (`-a`)
    - `RuboCop: Auto-correct entire file` (`-a` / `-A`)
    - `RuboCop: Disable cop for line / file`
  - Optional Format on Save via RuboCop.
- **Rails Best Practices:**
  - Detect common Rails anti-patterns: Law of Demeter violations, fat controllers, unused model methods, N+1 query vulnerability candidates.
- **RubyCritic & Complexity Visualizer:**
  - Inline CodeLens or status bar score displaying file ABC complexity (Assignment, Branch, Condition) and churn rating.
- **Brakeman Security Scanner:**
  - On-demand or on-save security audit for SQL injections, command injections, unsafe redirects, mass assignment vulnerabilities, and exposed secrets.

### 3.4 Pillar 4: Architecture, Refactoring & Code Enhancement
- **Design Pattern Extraction:**
  - `Extract to Service Object`: Extracts selected business logic into `app/services/[name]_service.rb` with standard `call` / `perform` idiom.
  - `Extract to Query Object`: Moves complex ActiveRecord chains into `app/queries/[name]_query.rb`.
  - `Extract to Form Object`: Refactors multi-model validation into `app/forms/[name]_form.rb`.
  - `Extract to Policy (Pundit)`: Generates `app/policies/[name]_policy.rb`.
- **SOLID Remediation:**
  - Single Responsibility check: Flags controllers with $> 7$ actions or models with $> 300$ lines.
  - Interface Segregation / Dependency Inversion hints.
- **N+1 Query Detection Heuristics:**
  - Identifies loops accessing associations without preceding `includes` / `eager_load`.

### 3.5 Pillar 5: Testing & Debugging
- **RSpec & Minitest Runner:**
  - Run single test, current context block, or full file with CodeLens `▶ Run Test` | `🐞 Debug Test`.
  - Inline pass/fail gutters and timing measurements.
- **FactoryBot & Fixtures IntelliSense:**
  - Auto-complete factory names (`create(:user)`, `build(:order)`) with attribute hints.
  - Jump from `create(:post)` directly to the factory definition in `spec/factories/posts.rb`.
- **Native Debugger Integration:**
  - 1-click launch configuration for `rdbg` (Ruby 3.1+ native debugger) and `pry`.

### 3.6 Pillar 6: AI Agent & Local LLM Integration (`@rails`)
- **VS Code / Cursor Chat Participant (`@rails`):**
  - Grounded with full project context: schema columns, route helpers, associations, active gemfile, and Rails conventions.
- **Slash Commands:**
  - `@rails /scaffold <name> <fields>`: Generates clean, convention-compliant models, controllers, migrations, and specs.
  - `@rails /service <name>`: Generates decoupled Service Object with error handling and result monads.
  - `@rails /fix`: Analyzes active RuboCop or RSpec failures and applies minimal, non-breaking patches.
  - `@rails /spec`: Generates complete, idiomatic RSpec unit/request tests using FactoryBot.
  - `@rails /migrate`: Generates safe ActiveRecord migration with reversible blocks and index optimizations.
  - `@rails /optimize`: Analyzes query execution, memory churn, and suggests eager-loading optimizations.
- **Self-Repairing Agent Loop:**
  - Proposes code $\to$ Runs `rubocop` / `rspec` $\to$ Captures failures $\to$ Auto-repairs until clean.

---

## 4. User Experience & Keybindings

| Keybinding (Linux/Win) | Keybinding (macOS) | Command Title | Action |
| :--- | :--- | :--- | :--- |
| `Alt+R M` | `Cmd+Alt+R M` | **RailsForge: Go to Model** | Switch to matching model |
| `Alt+R C` | `Cmd+Alt+R C` | **RailsForge: Go to Controller** | Switch to matching controller |
| `Alt+R V` | `Cmd+Alt+R V` | **RailsForge: Go to View** | Select and open matching view |
| `Alt+R S` | `Cmd+Alt+R S` | **RailsForge: Go to Spec/Test** | Switch to matching test file |
| `Alt+R R` | `Cmd+Alt+R R` | **RailsForge: Search Routes** | Interactive route search & copy |
| `Ctrl+Shift+P` $\to$ `RailsForge: RuboCop Autocorrect` | **RailsForge: RuboCop Autocorrect** | Run safe autocorrect on file |
| `Ctrl+Shift+P` $\to$ `RailsForge: Run Brakeman Security Scan` | **RailsForge: Brakeman Scan** | Display security vulnerability report |

---

## 5. Configuration Settings (`package.json`)

```json
{
  "railsForge.lsp.engine": "ruby-lsp",
  "railsForge.rubocop.autocorrectOnSave": true,
  "railsForge.rubocop.mode": "safe",
  "railsForge.brakeman.scanOnSave": false,
  "railsForge.testing.framework": "rspec",
  "railsForge.schema.autoIndex": true,
  "railsForge.routes.autoIndex": true,
  "railsForge.ollama.host": "http://localhost:11434",
  "railsForge.ollama.model": "qwen2.5-coder:14b",
  "railsForge.agent.autoRepair": true
}
```

---

## 6. Implementation Roadmap

| Phase | Objective | Deliverables |
| :--- | :--- | :--- |
| **Phase 1** | Foundation & Project Scaffold | Extension structure, `tsconfig.json`, `package.json`, build pipeline (`esbuild`/`webpack`), test harness (`vitest`). |
| **Phase 2** | Rails Knowledge & Indexing | `SchemaIndexer`, `RoutesIndexer`, `MVCNavigator`, `ViewPartialResolver`. |
| **Phase 3** | Quality & Static Analysis | `RuboCopLspClient`, `BrakemanScanner`, `RailsBestPracticesClient`, `RubyCriticLens`. |
| **Phase 4** | Refactoring & Architecture Engine | `ServiceExtractor`, `QueryExtractor`, `FormExtractor`, `NPlusOneDetector`. |
| **Phase 5** | Testing Integration | `RSpecRunner`, `MinitestRunner`, `FactoryBotIndexer`. |
| **Phase 6** | AI Agent & Chat Participant | `@rails` Chat Participant, Ollama client, Tool calling (`read_schema`, `read_routes`, `run_rspec`, `apply_patch`), Self-repair loop. |
| **Phase 7** | Verification & Packaging | Unit tests, E2E fixtures, VSIX packaging, Performance audit. |

---

## 7. Roadmap: Architectural Guardrail System (Phase 8+)

Positioning: RailsForge is the Rails-specific intelligence layer that sits
*alongside* `ruby-lsp` (Ruby syntax/diagnostics) and TypeScript tooling
(ESLint/Prettier/Tailwind), not a replacement for either — see README
"Relationship to Ruby LSP". The next phases extend that layer from "useful
Rails tools" toward keeping developers inside the project's own patterns and
SOLID/DRY/YAGNI/KISS conventions without opening 5–6 files to check "how did
we do this before."

**Shipped as of this iteration (regex/heuristic, no new native dependencies):**

- `ProjectPatternIndexer` — indexes `app/services|queries|forms|policies|decorators`
  and concerns; `railsforge.showSimilarPatterns` command + CodeLens surface the
  closest existing implementations for a given class.
- `@rails` agent grounding now includes a summary of existing patterns, with an
  explicit "search before generating" instruction in the system prompt.
- `ruby-lsp-addon/` — a companion Ruby gem (`RubyLsp::Addon`) that appends
  schema-aware hover into `ruby-lsp`'s own responses, proving the
  ruby-lsp-complementary integration model end to end for one feature slice.
- **Quick Fix / lightbulb layer on `DesignPrincipleLinter`**: Law of Demeter
  inserts a `delegate :method, to: :receiver`; YAGNI deletes the unused
  method's full block; every principle diagnostic also offers an
  "✨ AI: Suggest fix" action backed by `RailsAgent.suggestCodeFix` (reuses
  the existing Ollama config, no new AI client). `railsforge.fixAllInFile`
  batch-applies the deterministic fixes in a file.
- **`railsforge.extractService` is now a single atomic `WorkspaceEdit`**
  (create service file + insert content + replace only the selected range),
  so VS Code shows one multi-file diff preview and nothing outside the
  selection is touched. Free variables (`params`, `current_user`, any
  `receiver.method` in the selection) are now auto-detected instead of
  always extracting a zero-arg service.
- `MinimalDependencyGraph` (`src/graph/`) — regex-based (no AST library)
  collaborator graph over `ProjectPatternIndexer`'s patterns. Flags
  `PaymentGatewayService.call(...)`-style hard-coded collaborators with a
  "Inject `X` via constructor" Quick Fix that adds a keyword constructor
  param and rewrites call sites in that file to use it, and answers
  "who calls this service" (`getCallers`).
- `RelatedFilesIndex` (`src/graph/`) — reverse index from a model name to the
  services/queries/policies/decorators/concerns that reference it (by name
  match or `Model.find`/`.create`/`.where`-style usage in the body), plus a
  spec/test index keyed by `RSpec.describe`/Minitest `class XTest` subject.
  `RelatedCodeLensProvider` renders `🔗 3 Services · 2 Queries · 1 Policy · 6 Specs`
  on models and `🔗 Called by 7 · Depends on 3 · 2 Specs` on services/queries/
  policies (reusing `MinimalDependencyGraph`); `RelatedHoverProvider` shows the
  same on hover of the `class` line; `railsforge.showRelatedFiles` opens a
  quick-pick to jump straight to any of them. This is Phase 9 below, done.
- **Standalone Ruby/gem support**: `ProjectEnvironment.hasRails` is now `true`
  only when `rails` is an actual `Gemfile.lock` dependency (was previously
  defaulted to `'7.1.0'` unconditionally). `RailsAgent`'s system prompt and
  `RailsArchitectureTreeProvider`'s sidebar both branch on it instead of
  claiming a Rails version a plain gem/script doesn't have. `ProjectPatternIndexer`'s
  directory matching (`DIR_TYPE_MAP`) now matches `services/`, `queries/`,
  `forms/`, `policies/`, `decorators/`, `concerns/` anywhere in the path —
  not only under `app/` — so a gem's `lib/my_gem/services/*.rb` is indexed
  the same as `app/services/*.rb`, and the pattern catalog/dependency graph/
  related-files CodeLens work unmodified for gems. `DesignPrincipleLinter`'s
  SRP check now also fires in `lib/` (generic "split this up" message, no
  Rails-specific quick fix) instead of being silently scoped to `app/models`
  and `app/controllers` only.
- **Semantic code search** (`src/search/`): `EmbeddingClient` calls Ollama's
  `/api/embeddings` endpoint against a separate, configurable embedding model
  (`railsForge.ollama.embeddingModel`, default `nomic-embed-text`) — reusing
  the same host/fetch approach as `RailsAgent`, no new dependency.
  `SemanticSearchIndex` caches one vector per pattern in memory (keyed by
  file path + line + preview, so it re-embeds only when a pattern's content
  actually changes) and ranks results by cosine similarity; `pruneStale()` is
  called from the same file-watcher hooks that already rebuild
  `MinimalDependencyGraph`. When the embedding model/Ollama is unavailable it
  falls back to token-overlap keyword search over name/public-methods/preview
  — same "degrade, don't break" pattern as the rest of the AI-adjacent
  features. `railsforge.semanticSearch` exposes it as a command. This is
  Phase 10 below, done — chose the "no vector DB" path explicitly instead of
  FTS5/sqlite-vss, consistent with staying dependency-light until Phase 12 is
  revisited.

**Also shipped: Phases 8, 11, 12, 13, 14 (AST-backed analysis, `src/indexer/`, `src/mcp/`).**
The user explicitly signed off on the Phase 12 native-dependency tradeoff (asked
directly, chose "add better-sqlite3 + tree-sitter-ruby, worker thread, persistent
SQLite cache"), which unblocked 8/11/13/14 doing real AST analysis instead of
line regex. This is a *second, complementary* index alongside the original
regex-based `ProjectPatternIndexer`/`MinimalDependencyGraph`/`DesignPrincipleLinter`
— those are untouched and still the fallback if the native modules fail to load
on some platform (`PersistentIndexManager.activate()` catches that case and
returns `null`; every command checks for `null` and reports "still starting up /
unavailable" rather than crashing).

- `RubyAstParser` (`src/indexer/`) wraps `tree-sitter`/`tree-sitter-ruby`:
  extracts classes, superclass, `include`/`prepend`/`extend`, public/private
  methods (with full body text and constructor params), and calls (with
  receiver) from real parse trees.
- `database.ts` + `PersistentIndexer.ts`: SQLite schema (`symbols`, `methods`,
  `dependencies`, `embeddings` tables) and the upsert logic, unit-tested
  directly against `:memory:` — no worker thread needed for the tests.
  Content-hash based, so unchanged files are skipped on re-index.
- `indexer.worker.ts` + `PersistentIndexClient.ts`: the actual worker thread
  (parsing + SQLite writes happen off the extension host) and its main-thread
  handle. A `ready` handshake avoids the main thread opening its read-only
  connection before the worker has created the DB file. The DB lives at a
  **workspace-local** `.railsforge/index.sqlite3` (not VS Code's opaque
  per-workspace global storage) specifically so the standalone MCP server can
  find it without reconstructing VS Code's storage-path hashing.
- **Phase 8** — `DuplicateMethodDetector`: Jaccard token-overlap similarity
  over the `methods` table's normalized bodies, cross-file, not just
  within-file line-count heuristics. `railsforge.findDuplicateMethods`.
- **Phase 11** — `PersistentDependencyGraph`: DFS cycle detection over
  AST-derived edges (now including `include`/`prepend`/`extend`, not only
  `.call`/`.new`), plus `getCallers`/`getCollaborators`.
  `railsforge.showDependencyCycles`.
- **Phase 13** — `DuplicateCallSiteFinder` + `SpecFileGenerator`: `extractService`/
  `extractQuery` now search for exact duplicates of the selected code elsewhere
  in the workspace and offer to replace them too (one multi-file `WorkspaceEdit`),
  and generate a companion RSpec skeleton under `spec/services|queries/` when a
  `spec/` directory exists.
- **Phase 14** — `src/mcp/server.ts` (standalone Node process, own webpack
  entry, started by an MCP client — not loaded by the extension host) exposes
  `get_schema`, `list_routes`, `list_patterns`, `find_similar_pattern`,
  `get_dependencies`, `find_duplicate_methods` as MCP tools using
  `@modelcontextprotocol/sdk` (pure JS, no native/packaging concerns). Reuses
  `SchemaIndexer`/`RoutesIndexer`/`ProjectPatternIndexer` directly since none
  of them import `vscode`. `CursorRulesGenerator.ts` builds
  `.cursor/rules/railsforge.mdc`; `railsforge.exportCursorRules` writes it and
  merge-registers the MCP server into `.cursor/mcp.json` without clobbering
  any other servers already configured there.

**Packaging**: `better-sqlite3`/`tree-sitter`/`tree-sitter-ruby` are N-API
based with prebuilt binaries for macOS/Linux/Windows × x64/arm64 — N-API's
ABI stability means one prebuild per platform/arch works across Node
*and* Electron without a separate rebuild, which is what makes shipping
them in a `.vsix` tractable at all. Webpack externalizes them and a
`CopyWebpackPlugin` config copies only the runtime-necessary files
(prebuilds + JS glue, not the C/C++ source trees used solely for compiling
from scratch — that cut ~60MB down to ~30MB uncompressed) into
`dist/node_modules/`, dereferencing pnpm's symlinks (`vsce`'s default
dependency-pruning shells out to `npm ls`, which chokes on pnpm's
node_modules layout — confirmed by testing it directly). Verified
end-to-end: `vsce package --no-dependencies` produces a working ~11MB
`.vsix` with `dist/` containing `extension.js`, `indexer/indexer.worker.js`,
`mcp/server.js`, and `node_modules/` for the three native packages;
smoke-tested the worker (index → SQLite write → read back from a separate
connection) and the MCP server (spawned via stdio, `tools/list` +
`tools/call` round-trips) directly against the compiled `dist/` output.

**Critical caveat found via CI (not caught locally at first)**: ABI stability
only holds *within* the N-API version an addon requests. `better-sqlite3`
13.0.0–13.0.3 (every published N-API release, no lower-`NAPI_VERSION` build
exists) hardcodes `NAPI_VERSION=10`, which Node only backported to >= 22.14 /
23.6 — Node 20.x (confirmed directly: a real Node 20.20.2 binary reports
`process.versions.napi === '9'`) cannot load it. Worse, the failure mode
isn't a catchable JS exception — an addon requesting an unsupported N-API
version triggers `napi_fatal_error`, which aborts the *entire process*
immediately, so no `try/catch` around `PersistentIndexManager.activate()`
can protect against it. Since `database.ts` originally did
`const Database = require('better-sqlite3')` at module top level, merely
*importing* it (which happens transitively the moment `extension.ts` loads,
regardless of whether Phase 12 features are ever used) would have crashed
the whole extension host on any VS Code build whose Electron bundles
Node < 22.14 — a real risk given RailsForge's stated target platforms (VS
Code, Cursor, VSCodium, Windsurf) don't all track the same Electron/Node
version. Fixed with two changes: (1) `database.ts`'s `require('better-sqlite3')`
moved inside the function body (lazy — importing the module now touches
nothing native), and (2) `src/indexer/nativeSupport.ts`'s
`isPersistentIndexSupported()` (checks `process.versions.napi >= 10`) gates
every call site that would otherwise reach it — `PersistentIndexManager.activate()`
and the MCP server's `openPersistentDbReadonly()` — *before* that lazy
require ever executes, so an incompatible runtime degrades to "Phase
8/11/13/14 disabled" instead of crashing. The three SQLite-backed test files
use `describe.skipIf(!isPersistentIndexSupported())` for the same reason.
Verified by downloading a real Node v20.20.2 Linux x64 binary and running
the actual test suite against it: the 3 gated suites skip cleanly (15 tests),
all 59 others still pass — confirmed with the *real* CI Node version, not
just reasoned about.

**Still not implemented:**

Phase 10 (semantic code search, Ollama embeddings — see `src/search/`) shipped
independently on `claude/semantic-code-search` and has since merged to
`master`. That leaves only:

| Phase | Feature | Why it's separate | Key infra decision |
| :--- | :--- | :--- | :--- |
| 15 | Stimulus ↔ TypeScript cross-linking (Cmd+Click between `data-controller` and the `.ts` file) | Independent of everything above; can be picked up any time | None |
