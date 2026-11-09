/**
 * Ruby language MCP tools. These tools are deliberately read-only: source files are
 * resolved inside the workspace, bounded before parsing, and never evaluated.
 */

import * as fs from 'fs'
import * as path from 'path'
import { z } from 'zod'
import { RubyAstParser } from '../../indexer/RubyAstParser'
import type { ParsedTypeDefinition } from '../../indexer/RubyAstParser'
import { checkRubySyntax } from '../../util/RubySyntax'
import { resolveWithinRoot } from '../../util/WorkspacePath'
import type { ToolContext } from './ToolContext'
import type { ToolDefinition } from './definitions'

const MAX_SOURCE_BYTES = 1024 * 1024
const parser = new RubyAstParser()
const json = (value: unknown): string => JSON.stringify(value, null, 2)

function readRubySource(ctx: ToolContext, candidate: string): { file: string; content: string } | string {
  const resolved = resolveWithinRoot(ctx.workspaceRoot, candidate)
  if (!resolved.ok) { return `Refused to read source path: ${resolved.reason}` }
  if (path.extname(resolved.fullPath).toLowerCase() !== '.rb') {
    return 'Only .rb source files are supported.'
  }
  try {
    const stat = fs.statSync(resolved.fullPath)
    if (!stat.isFile()) { return 'The requested path is not a regular file.' }
    if (stat.size > MAX_SOURCE_BYTES) { return `Source file exceeds the ${MAX_SOURCE_BYTES} byte analysis limit.` }
    return { file: resolved.relative, content: fs.readFileSync(resolved.fullPath, 'utf8') }
  } catch {
    return 'Ruby source file could not be read.'
  }
}

function qualifiedName(type: ParsedTypeDefinition, all: ParsedTypeDefinition[]): string {
  if (type.name.includes('::')) { return type.name }
  const parent = all
    .filter(candidate => candidate !== type && candidate.startLine < type.startLine && candidate.endLine >= type.endLine)
    .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0]
  return parent ? `${qualifiedName(parent, all)}::${type.name}` : type.name
}

function symbolPayload(file: string, content: string): unknown {
  const types = parser.parseTypeDefinitions(content)
  return {
    file,
    typeCount: types.length,
    types: types.map(type => ({
      name: qualifiedName(type, types),
      kind: type.kind,
      superclass: type.superclass,
      startLine: type.startLine,
      endLine: type.endLine,
      includes: type.includes,
      methods: type.methods.map(method => ({
        name: method.name,
        visibility: method.visibility,
        params: method.params,
        signature: method.signature,
        startLine: method.startLine,
        endLine: method.endLine,
      })),
    })),
  }
}

function methodPayload(file: string, content: string, className: string, methodName: string): unknown | null {
  const types = parser.parseTypeDefinitions(content)
  const matches = types.flatMap(type => {
    const qualified = qualifiedName(type, types)
    if (qualified !== className && type.name !== className) { return [] }
    return type.methods.filter(method => method.name === methodName).map(method => ({
      file,
      className: qualified,
      methodName: method.name,
      visibility: method.visibility,
      signature: method.signature,
      params: method.params,
      startLine: method.startLine,
      endLine: method.endLine,
    }))
  })
  if (matches.length > 1) { return { ambiguous: true, matches } }
  return matches[0] ?? null
}

function readOptional(root: string, relative: string): string | null {
  const resolved = resolveWithinRoot(root, relative)
  if (!resolved.ok) { return null }
  try {
    const stat = fs.lstatSync(resolved.fullPath)
    return stat.isFile() && !stat.isSymbolicLink() ? fs.readFileSync(resolved.fullPath, 'utf8') : null
  } catch {
    return null
  }
}

function projectCapabilities(root: string): unknown {
  const rubyVersionFile = readOptional(root, '.ruby-version')?.trim() ?? null
  const lockfile = readOptional(root, 'Gemfile.lock')
  const lockRuby = lockfile?.match(/^RUBY VERSION\s*\n\s*ruby\s+([^\s]+)$/m)?.[1] ?? null
  const gemNames = new Set<string>()
  if (lockfile) {
    const lines = lockfile.split(/\r?\n/)
    const specsStart = lines.findIndex(line => line === '  specs:')
    if (specsStart >= 0) {
      for (const line of lines.slice(specsStart + 1)) {
        if (/^[A-Z][A-Z ]*$/.test(line)) { break }
        const match = /^    ([a-zA-Z0-9_.-]+) \(/.exec(line)
        if (match) { gemNames.add(match[1]) }
      }
    }
  }
  const frameworks = ['rails', 'rspec-rails', 'minitest', 'sidekiq', 'devise', 'pundit', 'factory_bot_rails']
    .filter(name => gemNames.has(name))
  const testDirectories = ['spec', 'test'].filter(name => {
    try {
      const stat = fs.lstatSync(path.join(root, name))
      return stat.isDirectory() && !stat.isSymbolicLink()
    } catch { return false }
  })
  return {
    declaredRubyVersion: rubyVersionFile || lockRuby,
    rubyVersionSource: rubyVersionFile ? '.ruby-version' : lockRuby ? 'Gemfile.lock' : null,
    bundleLockPresent: lockfile !== null,
    frameworks,
    railsApplication: fs.existsSync(path.join(root, 'config', 'application.rb')),
    testDirectories,
    executionPerformed: false,
    notes: ['Capabilities are inferred from workspace files; no Ruby process, Bundler command, or application code was executed.'],
  }
}

export const RUBY_LANGUAGE_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'ruby_get_symbols',
    title: 'Get Ruby symbols',
    description: 'Parses one workspace Ruby file with tree-sitter and returns class/module symbols, inheritance, mixins, method names, visibility, parameters and source ranges. Reads source only; does not execute Ruby.',
    inputSchema: { file: z.string().min(1).describe('Workspace-relative or absolute path to a .rb file') },
    invocationMessage: 'Parsing Ruby symbols',
    risk: 'R0',
    async handler(ctx, input) {
      const source = readRubySource(ctx, String(input.file ?? ''))
      if (typeof source === 'string') { return source }
      return json(symbolPayload(source.file, source.content))
    },
  },
  {
    name: 'ruby_get_method_details',
    title: 'Get Ruby method details',
    description: 'Returns a method's full declaration/signature, parameter names, visibility and exact source line range from a Ruby class/module. Requires file, class_name and method_name. Reads source only.',
    inputSchema: {
      file: z.string().min(1).describe('Workspace-relative or absolute path to a .rb file'),
      class_name: z.string().min(1).describe('Class or module name; nested constants use ::'),
      method_name: z.string().min(1).describe('Method name without #'),
    },
    invocationMessage: 'Reading Ruby method details',
    risk: 'R0',
    async handler(ctx, input) {
      const source = readRubySource(ctx, String(input.file ?? ''))
      if (typeof source === 'string') { return source }
      const result = methodPayload(source.file, source.content, String(input.class_name), String(input.method_name))
      if (!result) { return `No method ${String(input.class_name)}#${String(input.method_name)} found in ${source.file}.` }
      return json(result)
    },
  },
  {
    name: 'ruby_check_syntax',
    title: 'Check Ruby syntax',
    description: 'Runs ruby -c against the contents of one workspace .rb file (parse-only; the file is not loaded or evaluated). Requires project-code execution permission because it starts the Ruby executable.',
    inputSchema: { file: z.string().min(1).describe('Workspace-relative or absolute path to a .rb file') },
    invocationMessage: 'Checking Ruby syntax with ruby -c',
    risk: 'R2',
    async handler(ctx, input) {
      const source = readRubySource(ctx, String(input.file ?? ''))
      if (typeof source === 'string') { return source }
      const result = await checkRubySyntax(source.content)
      return json({ file: source.file, ...result, execution: 'ruby -c (parse-only; no file evaluation)' })
    },
  },
  {
    name: 'ruby_get_project_capabilities',
    title: 'Get Ruby project capabilities',
    description: 'Reports declared Ruby version, locked Rails/testing/framework gems, Rails application markers and test directories. Uses workspace files only; does not run Ruby, Bundler, Rails or tests.',
    inputSchema: {},
    invocationMessage: 'Inspecting declared Ruby project capabilities',
    risk: 'R0',
    async handler(ctx) {
      return json(projectCapabilities(ctx.workspaceRoot))
    },
  },
]
