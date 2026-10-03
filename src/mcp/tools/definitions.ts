/**
 * RailsForge tool definitions - ONE implementation shared by the standalone MCP server
 * (stdio) and the in-editor VS Code Language Model tools. Handlers return plain text.
 * vscode-free; the zod shapes are also used to generate package.json's `languageModelTools`.
 */

import * as fs from 'fs'
import * as path from 'path'
import { z } from 'zod'
import { PatternType } from '../../patterns/ProjectPatternIndexer'
import { PersistentDependencyGraph } from '../../indexer/PersistentDependencyGraph'
import { DuplicateMethodDetector } from '../../indexer/DuplicateMethodDetector'
import { GemSymbolResolver } from '../../docs/GemSymbolResolver'
import { RakeTaskIndexer } from '../../rake/RakeTaskIndexer'
import { getLearningResource } from '../../principles/LearningResources'
import { loadProjectGuidelines } from '../../config/ProjectGuidelines'
import { loadEffectiveServiceObjectGuidelines } from '../../config/EffectiveGuidelines'
import { formatSnapshotMarkdown, RuntimeSnapshot } from '../../rails/RuntimeIntrospector'
import { ToolContext } from './ToolContext'
import { buildSemanticContext } from '../../semantic/RailsContextBuilder'

export interface ToolDefinition {
  /** MCP tool name (snake_case); the VS Code tool name is `railsforge_<name>`. */
  name: string
  title: string
  description: string
  inputSchema: z.ZodRawShape
  /** Short sentence for the confirmation/progress UI in VS Code. */
  invocationMessage: string
  handler(ctx: ToolContext, input: Record<string, unknown>): Promise<string>
}

const json = (value: unknown): string => JSON.stringify(value, null, 2)
const NO_INDEX = 'RailsForge persistent index not found (.railsforge/index.sqlite3). Open this workspace in VS Code with RailsForge installed first.'
const PATTERN_TYPES = ['service', 'query', 'form', 'policy', 'decorator', 'concern'] as const

/** apidock.com groups docs under a top-level rails/ruby/rspec namespace; guess it from the class name's prefix. */
function classifyApiDockNamespace(className: string): 'rails' | 'ruby' | 'rspec' {
  if (/^RSpec\b/.test(className)) {return 'rspec'}
  if (/^(ActiveRecord|ActiveModel|ActiveSupport|ActionController|ActionView|ActionMailer|ActionCable|ActiveJob|AbstractController|ActionDispatch|Rails)\b/.test(className)) {return 'rails'}
  return 'ruby'
}

function defineTool<S extends z.ZodRawShape>(def: {
  name: string
  title: string
  description: string
  inputSchema: S
  invocationMessage: string
  handler(ctx: ToolContext, input: z.infer<z.ZodObject<S>>): Promise<string>
}): ToolDefinition {
  return def as unknown as ToolDefinition
}

export const RAILSFORGE_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: 'get_schema',
    title: 'Get ActiveRecord schema',
    description: 'Returns database columns for a model (or all tables if no model is given), from db/schema.rb.',
    inputSchema: { model: z.string().optional().describe('Model class name, e.g. "User"') },
    invocationMessage: 'Reading the ActiveRecord schema',
    async handler(ctx, { model }) {
      const schema = ctx.loadSchemaIndexer()
      if (model) {return json(schema.getModelColumns(model))}
      return json(schema.getAllTables().map(t => ({ name: t.name, columns: Array.from(t.columns.values()) })))
    },
  }),
  defineTool({
    name: 'list_routes',
    title: 'List Rails routes',
    description: 'Lists routes, optionally filtered by a search string matched against verb/path/controller#action.',
    inputSchema: { filter: z.string().optional() },
    invocationMessage: 'Listing Rails routes',
    async handler(ctx, { filter }) {
      const routes = ctx.loadRoutesIndexer()
      return json(filter ? routes.searchRoutes(filter) : routes.getAllRoutes())
    },
  }),
  defineTool({
    name: 'list_patterns',
    title: 'List project patterns',
    description: 'Lists this project\'s own Service/Query/Form/Policy/Decorator/Concern classes, optionally filtered by type.',
    inputSchema: { type: z.enum(PATTERN_TYPES).optional() },
    invocationMessage: 'Listing project patterns',
    async handler(ctx, { type }) {
      const indexer = ctx.loadPatternIndexer()
      const patterns = type ? indexer.getPatternsByType(type as PatternType) : indexer.getAllPatterns()
      return json(patterns.map(p => ({ name: p.name, type: p.type, filePath: p.filePath, publicMethods: p.publicMethods })))
    },
  }),
  defineTool({
    name: 'find_similar_pattern',
    title: 'Find similar existing pattern',
    description: 'Given a proposed class name (e.g. "CreateOrderService"), finds the closest existing Service/Query/etc. in this project — use before generating new code.',
    inputSchema: { name: z.string() },
    invocationMessage: 'Searching for similar existing patterns',
    async handler(ctx, { name }) {
      const indexer = ctx.loadPatternIndexer()
      const target = indexer.getAllPatterns().find(p => p.name === name)
      if (!target) {return `No existing pattern named "${name}" found; nothing to compare against.`}
      return json(indexer.findSimilar(target))
    },
  }),
  defineTool({
    name: 'get_dependencies',
    title: 'Get dependencies/callers',
    description: 'Returns collaborators (what this class depends on) and callers (what depends on this class), from the persistent AST index. Requires the workspace to have been opened in VS Code with RailsForge at least once.',
    inputSchema: { name: z.string() },
    invocationMessage: 'Reading the dependency graph',
    async handler(ctx, { name }) {
      const db = ctx.openPersistentDbReadonly()
      if (!db) {return NO_INDEX}
      const graph = new PersistentDependencyGraph(db)
      return json({ collaborators: graph.getCollaborators(name), callers: graph.getCallers(name) })
    },
  }),
  defineTool({
    name: 'find_duplicate_methods',
    title: 'Find near-duplicate methods',
    description: 'Checks the codebase for near-duplicate method bodies (candidates for extracting a shared concern/method) — call this before generating a new method, to avoid writing a redundant duplicate of existing logic. Requires the persistent AST index.',
    inputSchema: {},
    invocationMessage: 'Looking for near-duplicate methods',
    async handler(ctx) {
      const db = ctx.openPersistentDbReadonly()
      if (!db) {return NO_INDEX}
      return json(new DuplicateMethodDetector(db).findDuplicates())
    },
  }),
  defineTool({
    name: 'get_method_notes',
    title: 'Get APIDock method notes',
    description: 'Fetches apidock.com\'s community notes and doc summary for a Ruby/Rails/RSpec method — call this before generating code that uses an unfamiliar method, to ground it in real-world gotchas (skipped validations/callbacks, deprecated behavior, surprising defaults) that official docs often miss. This is APIDock only (community notes); for the official signature/description of a Ruby core or Rails framework method, prefer get_offline_docs instead — it\'s instant (no network call) when the docset is cached.',
    inputSchema: {
      method_name: z.string().describe('Method name, e.g. "update_attribute"'),
      class_name: z.string().describe('Class or module name, e.g. "ActiveRecord::Base"'),
    },
    invocationMessage: 'Fetching APIDock notes',
    async handler(ctx, { method_name, class_name }) {
      // Prefer the curated mapping, but only when it agrees with the caller's class_name.
      const indexed = ctx.apiDockMethodIndex.lookup(method_name)
      const normalized = class_name.replace(/::/g, '/')
      const lookup = indexed && indexed.className.toLowerCase() === normalized.toLowerCase()
        ? indexed
        : { namespace: classifyApiDockNamespace(class_name), className: normalized, methodName: method_name }
      const notes = await ctx.apiDockClient.fetchNotes(lookup)
      return notes ? json(notes) : `No APIDock notes found for ${class_name}#${method_name}.`
    },
  }),
  defineTool({
    name: 'get_gem_documentation',
    title: 'Get gem documentation (rubydoc.info)',
    description: 'Fetches YARD documentation (signature, description, params, return type) for a class/method in one of this project\'s dependency gems, at the exact version locked in Gemfile.lock — use this before generating code that calls into a gem (Pundit, Sidekiq, dry-rb, etc.) whose API isn\'t in RailsForge\'s own indexed patterns.',
    inputSchema: {
      gem_name: z.string().optional().describe('Gem name as it appears in Gemfile.lock, e.g. "pundit". Omitted: resolved from class_name\'s top-level namespace.'),
      class_name: z.string().describe('Class or module name, e.g. "Pundit" or "Sidekiq::Client"'),
      method_name: z.string().describe('Method name, e.g. "authorize"'),
      version: z.string().optional().describe('Exact gem version. Omitted: read from this project\'s Gemfile.lock.'),
    },
    invocationMessage: 'Fetching gem documentation',
    async handler(ctx, { gem_name, class_name, method_name, version }) {
      const locked = ctx.loadLockedGemVersions()
      let gem = gem_name
      let resolvedVersion = version
      if (!gem) {
        const resolved = new GemSymbolResolver(locked).resolve(class_name)
        if (!resolved) {
          return `Could not determine which gem defines "${class_name}" — pass gem_name explicitly, or check it's listed in this project's Gemfile.lock.`
        }
        gem = resolved.gem
        resolvedVersion = resolvedVersion ?? resolved.version
      }
      resolvedVersion = resolvedVersion ?? locked.get(gem)
      if (!resolvedVersion) {return `No locked version found for gem "${gem}" in Gemfile.lock, and no version was given.`}
      const entry = await ctx.rubyDocProvider.fetchMethod(gem, resolvedVersion, class_name, method_name)
      return entry ? json(entry) : `No rubydoc.info documentation found for ${gem}@${resolvedVersion} ${class_name}#${method_name}.`
    },
  }),
  defineTool({
    name: 'get_offline_docs',
    title: 'Get offline DevDocs documentation',
    description: 'Looks up a Ruby/Rails method or class in this project\'s locally cached DevDocs data (.railsforge/devdocs/, downloaded by the extension on activation) — instant, no network call, no tokens spent fetching a web page. Prefer this over get_method_notes/get_gem_documentation when you just need the official signature/description for a Ruby core or Rails framework method; use those for community gotchas or gem-specific (non-Rails) APIs instead.',
    inputSchema: {
      symbol_name: z.string().describe('Bare method name (e.g. "update_attribute") or class/module name (e.g. "ActiveRecord::Base")'),
    },
    invocationMessage: 'Looking up offline docs',
    async handler(ctx, { symbol_name }) {
      const result = ctx.getDevDocsIndex().lookup(symbol_name)
      if (!result) {
        return `No offline DevDocs entry found for "${symbol_name}". Either it isn't cached yet (open this workspace in VS Code with RailsForge, or run "RailsForge: Update Offline DevDocs Cache"), or it doesn't exist in the cached docset(s).`
      }
      return json(result)
    },
  }),
  defineTool({
    name: 'get_rbs_signature',
    title: 'Get RBS type signature',
    description: 'Returns the RBS (Ruby type signature) declaration for a method, from this project\'s sig/ directory, if one exists. Use this to check a method\'s declared parameter/return types before calling it or writing code against it.',
    inputSchema: {
      method_name: z.string().describe('Method name, e.g. "authorize"'),
      class_name: z.string().optional().describe('Class/module name to disambiguate when the same method name is declared on multiple classes'),
    },
    invocationMessage: 'Reading RBS signatures',
    async handler(ctx, { method_name, class_name }) {
      const index = ctx.getRbsIndex()
      if (index.isEmpty) {return 'No RBS signatures found (no sig/ directory, or it\'s empty).'}
      const matches = index.lookup(method_name)
      const filtered = class_name ? matches.filter(m => m.className === class_name) : matches
      if (filtered.length === 0) {return `No RBS signature found for ${class_name ? `${class_name}#${method_name}` : method_name}.`}
      return json(filtered)
    },
  }),
  defineTool({
    name: 'list_rake_tasks',
    title: 'List Rake tasks',
    description: 'Lists this project\'s Rake tasks (name, namespace, description) via `rake -T` — use before suggesting a shell command, to check whether a task for it already exists (e.g. db:migrate, a custom deploy/report task) rather than proposing a new script.',
    inputSchema: { filter: z.string().optional().describe('Only return tasks whose name contains this substring') },
    invocationMessage: 'Listing Rake tasks',
    async handler(ctx, { filter }) {
      const tasks = await new RakeTaskIndexer().listTasks(ctx.workspaceRoot)
      const filtered = filter ? tasks.filter(t => t.name.includes(filter)) : tasks
      return filtered.length === 0 ? 'No Rake tasks found (no Rakefile, rake not installed, or no tasks matched the filter).' : json(filtered)
    },
  }),
  defineTool({
    name: 'suggest_learning_resource',
    title: 'Suggest a learning resource for a design smell',
    description: 'Given one of RailsForge\'s own design-principle diagnostic ids (SRP-FAT-CLASS, DEMETER-VIOLATION, KISS-METAPROGRAMMING, YAGNI-UNUSED-PRIVATE — as seen in this project\'s "RailsForge Principles" diagnostics), returns a specific book/chapter recommendation for further reading.',
    inputSchema: { diagnostic_id: z.enum(['SRP-FAT-CLASS', 'DEMETER-VIOLATION', 'KISS-METAPROGRAMMING', 'YAGNI-UNUSED-PRIVATE']) },
    invocationMessage: 'Finding a learning resource',
    async handler(_ctx, { diagnostic_id }) {
      const resource = getLearningResource(diagnostic_id as string)
      return resource ? json(resource) : `No learning resource mapped for "${diagnostic_id}".`
    },
  }),
  defineTool({
    name: 'get_project_guidelines',
    title: 'Get project architecture guidelines',
    description: 'Returns this project\'s actual conventions — from .railsforge.yml if the team wrote one, otherwise learned from the codebase\'s own existing Service Objects (majority base class + entry-point method name, only when the codebase actually agrees on one) — so an AI agent generates a Service Object matching this repo\'s real pattern (e.g. `Interactor`/`run`) instead of assuming the generic Rails-generator default (`ApplicationService`/`call`). Call this before generating a new Service Object.',
    inputSchema: {},
    invocationMessage: 'Reading project guidelines',
    async handler(ctx) {
      const explicit = loadProjectGuidelines(ctx.workspaceRoot)
      const serviceObjects = loadEffectiveServiceObjectGuidelines(ctx.workspaceRoot, ctx.loadPatternIndexer())
      return json({
        serviceObjects,
        preferredLibraries: explicit?.preferredLibraries ?? null,
        testing: explicit?.testing ?? null,
        configFile: explicit ? '.railsforge.yml' : null,
      })
    },
  }),
  defineTool({
    name: 'get_example_file',
    title: 'Get a representative example file for a pattern type',
    description: 'Returns the full content of this project\'s most complete existing Service/Query/Form/Policy/Decorator/Concern, so an AI agent can learn the repo\'s real style (naming, error handling, how it structures the class) by example instead of guessing. Call this alongside get_project_guidelines before generating a new file of the same pattern type.',
    inputSchema: { pattern_type: z.enum(PATTERN_TYPES) },
    invocationMessage: 'Reading a representative example file',
    async handler(ctx, { pattern_type }) {
      const candidates = ctx.loadPatternIndexer().getPatternsByType(pattern_type as PatternType)
      if (candidates.length === 0) {return `No existing ${pattern_type} found in this project to use as an example.`}
      // "Most complete" as a proxy for "most representative": the one with the most public methods.
      const best = candidates.reduce((a, b) => (b.publicMethods.length > a.publicMethods.length ? b : a))
      try {
        return json({ filePath: best.filePath, name: best.name, content: fs.readFileSync(best.filePath, 'utf8') })
      } catch {
        return `Found ${best.name} at ${best.filePath} but could not read the file.`
      }
    },
  }),
  defineTool({
    name: 'get_semantic_context',
    title: 'Get Rails application context (semantic graph)',
    description: 'Returns how the parts of THIS Rails app connect for a file or topic: controller actions with their routes and views, models with table/columns/indexes/foreign keys, associations, validations, callbacks, scopes, related services/policies/specs/migrations and who calls whom. Call this FIRST when asked to change or debug a controller, model, service or query, so the change fits the real structure (e.g. before fixing an N+1 in OrdersController#index). Pass a file path and/or class names/controller#action in query.',
    inputSchema: {
      file: z.string().optional().describe('Project-relative or absolute path of the file being worked on'),
      query: z.string().optional().describe('Free text naming classes/tables/actions, e.g. "N+1 in OrdersController#index"'),
      max_chars: z.number().int().min(500).max(20000).optional(),
    },
    invocationMessage: 'Reading the Rails semantic graph',
    async handler(ctx, { file, query, max_chars }) {
      if (!file && !query) {return 'Provide `file` and/or `query` (class names, tables or controller#action) so RailsForge knows which part of the app to describe.'}
      const text = buildSemanticContext(ctx.getSemanticGraph(), { filePath: file, prompt: query, maxChars: max_chars ?? 6000, maxSeeds: 6 })
      return text || 'No known Rails entities matched. Check the class names, or pass the file path of the code you are changing.'
    },
  }),
  defineTool({
    name: 'get_runtime_introspection',
    title: 'Get Rails runtime introspection',
    description: 'Returns what the RUNNING Rails app knows — real ActiveRecord associations, validations, callbacks, routes and middleware — from the cached `rails runner` snapshot (.railsforge/runtime.json). More accurate than static parsing for metaprogrammed models. Only available after the developer ran "RailsForge: Refresh Rails Runtime Introspection" (it boots the app, so it is never run automatically).',
    inputSchema: {
      model: z.string().optional().describe('Only this model (e.g. "User"); omitted: a summary of every model plus routes'),
      format: z.enum(['json', 'markdown']).optional(),
    },
    invocationMessage: 'Reading cached Rails runtime introspection',
    async handler(ctx, { model, format }) {
      const file = path.join(ctx.workspaceRoot, '.railsforge', 'runtime.json')
      let snapshot: RuntimeSnapshot
      try {
        snapshot = JSON.parse(fs.readFileSync(file, 'utf8')) as RuntimeSnapshot
      } catch {
        return 'No runtime introspection snapshot found. Ask the developer to run "RailsForge: Refresh Rails Runtime Introspection" (it boots the Rails app, so it is opt-in).'
      }
      if (model) {
        const found = snapshot.models.find(m => m.name === model)
        if (!found) {return `No model named "${model}" in the snapshot (captured ${snapshot.capturedAt ?? 'unknown'}).`}
        return json(found)
      }
      return format === 'markdown' ? formatSnapshotMarkdown(snapshot) : json({ ...snapshot, models: snapshot.models.map(m => ({ name: m.name, table: m.table, associations: m.associations.length, validations: m.validations.length, callbacks: m.callbacks.length })) })
    },
  }),
]
