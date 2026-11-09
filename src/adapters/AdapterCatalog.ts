/**
 * AdapterCatalog - the optional developer tools RailsForge can use, and how each is installed.
 *
 * Every fact here was checked against the tool's RubyGems or npm entry, or its README. RailsForge never requires
 * any of these tools. Installing one is always the user's decision, made from the IDE, and the install command is
 * placed in a terminal for the user to review and run. RailsForge never runs an install command by itself.
 *
 * vscode-free.
 */

export const ADAPTER_IDS = [
  'rails-mcp-server',
  'ruby-console-mcp',
  'actionmcp',
  'ask-rails-harness-mcp',
  'ask-ruby-harness-mcp',
  'debug-mcp',
  'gems-mcp',
] as const

export type AdapterId = (typeof ADAPTER_IDS)[number]

/**
 * tool-environment: installed outside the application (a global gem or npm package), so the application's
 * Gemfile and files stay as they are. project: changes the application itself (a Gemfile entry, migrations,
 * generated files), so the user must run it deliberately.
 */
export type InstallScope = 'tool-environment' | 'project'

export interface InstallPlan {
  label: string
  scope: InstallScope
  /** Run in order, shown to the user as one line, and never executed by RailsForge. */
  steps: readonly string[]
}

/**
 * How much authority the tool has once it is connected. `arbitrary-execution` means it can run code the caller
 * supplies (an evaluator, a console, a generic command runner). `project-code` means it runs the application's
 * own code. `unverified` means its capabilities have not been checked here.
 */
export type Authority = 'project-code' | 'arbitrary-execution' | 'unverified'

export interface AdapterEntry {
  id: AdapterId
  label: string
  package:
    | { kind: 'ruby-gem'; name: string; executable: string | null }
    | { kind: 'npm'; name: string; executable: string }
  summary: string
  /** Minimum Ruby the tool states, or null when none is stated. */
  minimumRuby: string | null
  /** Minimum Node the package states, or null when none is stated. */
  minimumNode: string | null
  /** Where the requirement comes from, so a reader can check it. */
  requirementSource: string
  installs: readonly InstallPlan[]
  notes: readonly string[]
  authority: Authority
}

export const ADAPTERS: readonly AdapterEntry[] = [
  {
    id: 'rails-mcp-server',
    label: 'rails-mcp-server',
    package: { kind: 'ruby-gem', name: 'rails-mcp-server', executable: 'rails-mcp-server' },
    summary: 'Rails project inspection over MCP: routes, models, schema and controllers. It runs the application\'s bin/rails to introspect it.',
    minimumRuby: '3.3.0',
    minimumNode: null,
    requirementSource: 'RubyGems (latest release 2.0.0)',
    installs: [
      { label: 'Install the gem globally', scope: 'tool-environment', steps: ['gem install rails-mcp-server'] },
    ],
    notes: [
      'Keep it out of the application Gemfile. Its README does not ask for a Gemfile entry.',
      'Projects are listed in ~/.config/rails-mcp/projects.yml, or %APPDATA%\\rails-mcp on Windows.',
      'rails-mcp-config, a second executable of the same gem, manages the project list.',
    ],
    authority: 'project-code',
  },
  {
    id: 'ruby-console-mcp',
    label: 'ruby-console-mcp',
    package: { kind: 'npm', name: 'ruby-console-mcp', executable: 'ruby-console-mcp' },
    summary: 'Rails console, IRB or Racksh sessions over MCP, with a persistent session.',
    minimumRuby: null,
    minimumNode: null,
    requirementSource: 'none stated in the npm package',
    installs: [
      { label: 'Install the npm package globally', scope: 'tool-environment', steps: ['npm install -g ruby-console-mcp'] },
    ],
    notes: [
      'Its default command is `bundle exec rails c`, which runs the application and evaluates Ruby the caller supplies.',
      'Configured with RUBY_APP_PATH, RUBY_CONSOLE_COMMAND and COMMAND_TIMEOUT.',
      'RailsForge does not expose it.',
    ],
    authority: 'arbitrary-execution',
  },
  {
    id: 'actionmcp',
    label: 'ActionMCP',
    package: { kind: 'ruby-gem', name: 'actionmcp', executable: null },
    summary: 'Lets an application expose its own operations as MCP tools, over HTTP.',
    minimumRuby: '3.4.8',
    minimumNode: null,
    requirementSource: 'README (the RubyGems page states no floor)',
    installs: [
      {
        label: 'Add ActionMCP to this application',
        scope: 'project',
        steps: [
          'bundle add actionmcp',
          'bin/rails action_mcp:install:migrations',
          'bin/rails generate action_mcp:install',
          'bin/rails db:migrate',
        ],
      },
    ],
    notes: [
      'Changes the application: a Gemfile entry, migrations and a generated installer. Add it only when the application should expose tools.',
      'Its README says it does not support STDIO, so editor clients that use stdio cannot connect to it.',
      'Its README requires Rails 8.1.1 or newer.',
    ],
    authority: 'project-code',
  },
  {
    id: 'ask-rails-harness-mcp',
    label: 'ask-rails-harness-mcp',
    package: { kind: 'ruby-gem', name: 'ask-rails-harness-mcp', executable: 'ask-rails-harness-mcp' },
    summary: 'Test running, read-only database queries, model and route inspection, log reading and a generic command runner for a Rails application.',
    minimumRuby: '3.2.0',
    minimumNode: null,
    requirementSource: 'RubyGems (latest release 0.2.9)',
    installs: [
      { label: 'Add to this application', scope: 'project', steps: ['bundle add ask-rails-harness-mcp'] },
    ],
    notes: [
      'Run it from the application root with `bundle exec ask-rails-harness-mcp`. Its README does not name a Gemfile group.',
      'Includes a generic run_command tool. Disable it in any client that does not need it.',
    ],
    authority: 'arbitrary-execution',
  },
  {
    id: 'ask-ruby-harness-mcp',
    label: 'ask-ruby-harness-mcp',
    package: { kind: 'ruby-gem', name: 'ask-ruby-harness-mcp', executable: null },
    summary: 'Ruby project tooling over MCP, usable in any Ruby project. Its tools are not verified here.',
    minimumRuby: '3.2.0',
    minimumNode: null,
    requirementSource: 'RubyGems (latest release 0.2.1)',
    installs: [
      { label: 'Install the gem globally', scope: 'tool-environment', steps: ['gem install ask-ruby-harness-mcp'] },
    ],
    notes: [
      'Its executable name is not verified here. Read it from the gem specification before launching the tool.',
    ],
    authority: 'unverified',
  },
  {
    id: 'debug-mcp',
    label: 'debug-mcp',
    package: { kind: 'ruby-gem', name: 'debug-mcp', executable: 'debug-mcp' },
    summary: 'Runtime debugging of a Ruby process: call stack, variables, source, breakpoints and stepping.',
    minimumRuby: '3.2.0',
    minimumNode: null,
    requirementSource: 'RubyGems (latest release 0.4.0) and README',
    installs: [
      { label: 'Install the gem globally (recommended)', scope: 'tool-environment', steps: ['gem install debug-mcp'] },
      { label: 'Add to this application (optional)', scope: 'project', steps: ['bundle add debug-mcp --group development'] },
    ],
    notes: [
      'Attaches to a Ruby process over a socket. The debug gem has no authentication, so use a Unix socket or localhost only.',
      'evaluate_code runs arbitrary Ruby in the paused process.',
      'The target application still needs a debugger setup (rdbg and the debug gem). Installing this tool does not provide it.',
    ],
    authority: 'arbitrary-execution',
  },
  {
    id: 'gems-mcp',
    label: '@ruby-mcp/gems-mcp',
    package: { kind: 'npm', name: '@ruby-mcp/gems-mcp', executable: 'gems-mcp' },
    summary: 'RubyGems.org lookups, gem versions, and Gemfile and gemspec parsing.',
    minimumRuby: null,
    minimumNode: '18.0.0',
    requirementSource: 'npm engines (node >= 18.0.0)',
    installs: [
      { label: 'Install the npm package globally', scope: 'tool-environment', steps: ['npm install -g @ruby-mcp/gems-mcp'] },
    ],
    notes: [
      'Its README lists Gemfile edits and bundle install operations. Review any change it proposes before accepting it.',
      'The npm metadata names github.com/ruby-mcp/ruby-mcp, but the README clone command names fugufish/ruby-mcp. Check the source before you trust either.',
    ],
    authority: 'project-code',
  },
]

export function adapterById(id: string): AdapterEntry | undefined {
  return ADAPTERS.find(entry => entry.id === id)
}

export function isAdapterId(value: string): value is AdapterId {
  return (ADAPTER_IDS as readonly string[]).includes(value)
}
