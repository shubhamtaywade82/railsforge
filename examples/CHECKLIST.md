# RailsForge Manual Verification Checklist

Comprehensive manual verification guide for testing **RailsForge** locally across different Ruby and Rails project archetypes in VS Code and Cursor.

---

## 1. Local Extension Installation

The extension package is built at `railsforge.vsix`.

### Option A: Via Command Line (CLI)

```bash
# For VS Code
code --install-extension ./railsforge.vsix --force

# For Cursor
cursor --install-extension ./railsforge.vsix --force
```

### Option B: Via IDE User Interface (UI)

1. Open the **Extensions** view (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Click the **`...`** (Views and More Actions) menu in the top-right corner of the Extensions panel.
3. Select **Install from VSIX...** and choose `railsforge.vsix`.
4. Reload or restart your IDE window when prompted.

---

## 2. Test Workspaces Structure

The demo workspaces under [`examples/`](./) (and `../extension-workspace/`) cover 4 distinct Ruby project types:

```text
examples/ (or extension-workspace/)
├── rails-monolith/   # Full MVC Rails 7.1 app (Stimulus, Turbo, Pundit, ViewComponent, Strong Migrations)
├── rails-api/        # API-only Rails 7.1 app (config.api_only = true & OpenAPI target)
├── ruby-gem/         # Ruby Gem library (.gemspec, version.rb, Rake tasks, RBS target)
└── ruby-script/      # Plain Ruby script (CLI runner, processor, REPL target)
```

---

## 3. Manual Verification Checklist

### A. Full Rails Monolith (`rails-monolith`)

Open the `rails-monolith/` folder in your IDE to test:

- [ ] **Architecture & Health Sidebar**
  - Open the RailsForge Activity Bar icon (`ruby`).
  - Verify that *Architecture & Health* correctly detects: `Monolith (full MVC)`, `Rails 7.1.0`, `Ruby 3.3.0`, and active flags for Turbo, Stimulus, Pundit, and ViewComponent.
- [ ] **DevDocs & APIDock Documentation Integration**
  - Open `app/models/article.rb` and hover over `has_many`, `belongs_to`, `validates`, `enum`. Verify offline DevDocs summary and APIDock community notes appear in hover tooltips.
  - Press `Alt+R D` (or command `RailsForge: Open DevDocs`) to verify the interactive DevDocs webview opens beside the active editor.
  - Run command `RailsForge: Open Gem Documentation` and type `pundit` or `view_component` to test RubyDoc.info fetching.
- [ ] **Fast MVC Navigation**
  - In `app/models/article.rb`:
    - `Alt+R C` → jumps to `app/controllers/articles_controller.rb`.
    - `Alt+R V` → jumps to `app/views/articles/index.html.erb`.
    - `Alt+R S` → jumps to `spec/models/article_spec.rb`.
    - `Alt+R M` → jumps back to `app/models/article.rb`.
  - Run `RailsForge: Go to Pundit / CanCanCan Policy` → opens `app/policies/article_policy.rb`.
  - Run `RailsForge: Go to ViewComponent` → opens `app/components/article_card_component.rb`.
- [ ] **Schema Peek & Route Search**
  - Run `RailsForge: Peek Model Schema` → confirms schema definition for `articles`, `users`, and `comments` parsed from `db/schema.rb`.
  - Press `Alt+R R` (`RailsForge: Search Rails Routes`) → searches and filters routes defined in `config/routes.rb`.
- [ ] **Rake Tasks Explorer**
  - Expand the *Rake Tasks* tree view in the sidebar → confirms `articles:publish_scheduled` and `articles:recalculate_views` are discovered and executable.
- [ ] **Service Generator & Pattern Engine**
  - Run `RailsForge: Generate New Service Object` → confirms directory resolution works and creates the new service template.
  - Run `RailsForge: Apply Community RuboCop Style Guide` → inspect style presets (`Shopify` / `GitLab` / `Airbnb`).

---

### B. Rails API-Only (`rails-api`)

Open the `rails-api/` folder in your IDE to test:

- [ ] **Adaptive Project Type Detection**
  - Confirm *Architecture & Health* tree view detects `API-only` mode (via `config.api_only = true`).
  - Confirm view navigation commands (`Alt+R V` / *Go to Matching View*) are automatically filtered out from the Command Palette.
- [ ] **OpenAPI 3.0 Skeleton Generator**
  - Run command `RailsForge: Generate OpenAPI Skeleton`.
  - Check that it scans `app/controllers/api/v1/products_controller.rb` and `config/routes.rb` to output a structured OpenAPI specification.

---

### C. Ruby Gem / Library (`ruby-gem`)

Open the `ruby-gem/` folder in your IDE to test:

- [ ] **Gem Project Type Detection**
  - *Architecture & Health* view identifies project type as `Gem` (`my_toolbox.gemspec`).
  - Non-Rails commands are hidden, and Gem lifecycle commands become active.
- [ ] **Gem Version Bumper**
  - Run `RailsForge: Bump Gem Version` → select `patch` → verify `lib/my_toolbox/version.rb` updates from `0.1.0` to `0.1.1`.
- [ ] **RBS Signature Generation**
  - Open `lib/my_toolbox/string_utils.rb` and run `RailsForge: Generate RBS Signatures for File` → verify generated signatures in `sig/`.
- [ ] **Rake Explorer**
  - Check that Bundler gem tasks (`rake release`, `rake build`, `rake spec`, `rake build:native`) are listed in the *Rake Tasks* view.

---

### D. Plain Ruby Script (`ruby-script`)

Open the `ruby-script/` folder in your IDE to test:

- [ ] **Script Project Type Detection**
  - *Architecture & Health* view identifies project type as `Script`.
- [ ] **REPL Selection Evaluation**
  - Open `lib/data_processor.rb`, select a code snippet, and press `Alt+R E` (`RailsForge: Evaluate Selection in REPL`).
- [ ] **RuboCop Autocorrect**
  - Run `RailsForge: RuboCop Autocorrect File` on `bin/crawler.rb`.

---

### E. Cursor Rules & MCP Registration (Cursor / Claude Code)

- [ ] In any project, run `RailsForge: Export Cursor Rules & Register MCP Server`.
- [ ] Verify that `.cursorrules` / `.cursor/rules/railsforge.mdc` and `.cursor/mcp.json` are created and the MCP server starts when queried.
