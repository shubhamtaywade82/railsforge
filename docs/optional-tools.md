# Optional Developer Tools

RailsForge can offer to install seven optional MCP tools. RailsForge does not require any of them. The extension detects whether a tool is installed, asks you to install it when you have enabled it and it is missing, and places the install command in a terminal for you to review and run. RailsForge never runs an install command itself, and it never edits your Gemfile.

## Install scope

Two scopes exist. A **tool environment** install is a global gem or npm package, so the application's Gemfile and files do not change. A **project** install changes the application (a Gemfile entry, migrations, generated files), so it is run only deliberately.

| Tool | Package | Scope | Install | Authority | Requirement (source) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `rails-mcp-server` | RubyGems | tool environment | `gem install rails-mcp-server` | project code (runs `bin/rails`) | Ruby 3.3.0+ (RubyGems, latest 2.0.0) |
| `ruby-console-mcp` | npm | tool environment | `npm install -g ruby-console-mcp` | arbitrary execution (evaluates caller-supplied Ruby) | none stated |
| ActionMCP (`actionmcp`) | RubyGems | **project** | `bundle add actionmcp`, then `bin/rails action_mcp:install:migrations`, `bin/rails generate action_mcp:install`, `bin/rails db:migrate` | project code | Ruby 3.4.8+ or 4.0.0+, Rails 8.1.1+ (README); no STDIO transport |
| `ask-rails-harness-mcp` | RubyGems | **project** | `bundle add ask-rails-harness-mcp` | arbitrary execution (includes a generic `run_command` tool) | Ruby 3.2.0+ (RubyGems, latest 0.2.9) |
| `ask-ruby-harness-mcp` | RubyGems | tool environment | `gem install ask-ruby-harness-mcp` | unverified | Ruby 3.2.0+ (RubyGems, latest 0.2.1) |
| `debug-mcp` | RubyGems | tool environment (recommended), or project (optional) | `gem install debug-mcp`, or `bundle add debug-mcp --group development` | arbitrary execution (`evaluate_code` runs Ruby in the paused process) | Ruby 3.2.0+ (RubyGems, latest 0.4.0, README) |
| `@ruby-mcp/gems-mcp` | npm | tool environment | `npm install -g @ruby-mcp/gems-mcp` | project code (its README lists Gemfile edits) | Node 18.0.0+ (npm engines) |

Each tool's notes, including the caveats its README raises, are shown in the RailsForge details view. The catalog is `src/adapters/AdapterCatalog.ts`, and every requirement names its source.

## How RailsForge detects a tool

- **Project gem:** a gem locked in the application's `Gemfile.lock` is reported as installed in the project. The lockfile is read as text, and no code runs.
- **Global install:** otherwise RailsForge asks the machine, with `gem list -i <name>` for gems and `npm ls -g <name> --depth=0 --json` for npm packages. It also reads the Ruby version with `ruby -e "print RUBY_VERSION"` when a tool states a minimum.
- **Trust:** every machine probe goes through the workspace trust gate. In an untrusted workspace the probes do not run, and the state reads "Not checked. Trust this workspace to check global installs."
- **Missing** means the probe answered that the tool is not installed. A probe that could not run, because the toolchain is absent or the command failed, never reports a tool as missing.

## IDE behaviour

- `railsForge.adapters.enabled` lists the tools RailsForge should offer. For each enabled tool that is missing, RailsForge shows one notification per window session with four choices: **Install…**, **Details**, **Not now**, and **Don't ask in this workspace**.
- **RailsForge: Optional Tools Status** lists every tool with its state. Choose a missing tool to install it, or any other tool to read its details.
- **RailsForge: Install Optional Tool…** lists the tools that are known to be missing.
- **Install** opens a RailsForge terminal in the workspace root and types the command without pressing Enter. Read it, then press Enter. A tool with two install plans asks which one to use first.
- In an untrusted workspace, install opens no terminal. It offers only to copy the command.

## Settings

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `railsForge.adapters.enabled` | `string[]` | `[]` | Tools to offer for installation when they are missing. Values are the ids in the table above. |
| `railsForge.adapters.promptWhenMissing` | `boolean` | `true` | Ask to install an enabled tool when it is missing. Set to `false` to use only the status and install commands. |

## What this does not do yet

RailsForge does not start an installed tool or connect it to a feature. `launchSpecFor` in `src/adapters/AdapterStatus.ts` builds the launch command (`bundle exec <executable>` for a project gem, `<executable>` for a global one), but no feature calls it yet. Connecting each tool to RailsForge is a separate change for each tool, and it is not part of the install flow.
