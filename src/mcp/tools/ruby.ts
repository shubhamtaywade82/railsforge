/**
 * Ruby Language MCP Tools - AST, symbols, method details, syntax validation,
 * and project capabilities. Pure Node / tree-sitter backed (vscode-free).
 */

import * as fs from 'fs'
import * as path from 'path'
import { z } from 'zod'
import { RubyAstParser } from '../../indexer/RubyAstParser'
import { checkRubySyntax } from '../../util/RubySyntax'
import { resolveWithinRoot } from '../../util/WorkspacePath'
import { EnvironmentDetector } from '../../environment/EnvironmentDetector'
import type { ToolContext } from './ToolContext'
import type { ToolDefinition } from './definitions'

const json = (value: unknown): string => JSON.stringify(value, null, 2)

function defineTool<S extends z.ZodRawShape>(def: {
  name: string
  title: string
  description: string
  inputSchema: S
  invocationMessage: string
  risk: ToolDefinition['risk']
  handler(ctx: ToolContext, input: z.infer<z.ZodObject<S>>): Promise<string>
}): ToolDefinition {
  return def as unknown as ToolDefinition
}

function readWorkspaceFile(root: string, candidatePath: string): { ok: true; content: string } | { ok: false; error: string } {
  const resolved = resolveWithinRoot(root, candidatePath)
  if (!resolved.ok) {
    return { ok: false, error: `Invalid path: ${resolved.reason}` }
  }
  if (!fs.existsSync(resolved.fullPath)) {
    return { ok: false, error: `File not found: ${candidatePath}` }
  }
  try {
    return { ok: true, content: fs.readFileSync(resolved.fullPath, 'utf8') }
  } catch (err) {
    return { ok: false, error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` }
  }
}

function findTargetType(
  types: ReturnType<RubyAstParser['parseTypeDefinitions']>,
  methodName: string,
  className?: string,
) {
  if (className) {
    return types.find(t => t.name === className || t.name.endsWith(`::${className}`))
  }
  return types.find(t => t.methods.some(m => m.name === methodName))
}

export const RUBY_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: 'ruby_get_symbols',
    risk: 'R0',
    title: 'Get Ruby symbols from file',
    description: 'Extracts classes, modules, methods, superclasses, includes, and line ranges from a Ruby file using tree-sitter AST.',
    inputSchema: {
      path: z.string().describe('Workspace-relative path to Ruby file, e.g. "app/models/user.rb"'),
    },
    invocationMessage: 'Extracting Ruby symbols',
    async handler(ctx: ToolContext, { path: filePath }) {
      const read = readWorkspaceFile(ctx.workspaceRoot, filePath)
      if (!read.ok) {return json({ error: read.error })}

      const parser = new RubyAstParser()
      const types = parser.parseTypeDefinitions(read.content)
      return json({
        filePath,
        types: types.map(t => ({
          name: t.name,
          kind: t.kind,
          superclass: t.superclass,
          startLine: t.startLine,
          endLine: t.endLine,
          includes: t.includes,
          methods: t.methods.map(m => ({
            name: m.name,
            isPublic: m.isPublic,
            startLine: m.startLine,
            endLine: m.endLine,
            params: m.params,
          })),
        })),
      })
    },
  }),

  defineTool({
    name: 'ruby_get_method_details',
    risk: 'R0',
    title: 'Get Ruby method details',
    description: 'Returns parameters, visibility, line ranges, and internal calls for a specific Ruby method in a file.',
    inputSchema: {
      path: z.string().describe('Workspace-relative path to Ruby file'),
      method_name: z.string().describe('Method name to inspect, e.g. "calculate_total"'),
      class_name: z.string().optional().describe('Class or module name to disambiguate if multiple types exist'),
    },
    invocationMessage: 'Inspecting Ruby method details',
    async handler(ctx: ToolContext, { path: filePath, method_name, class_name }) {
      const read = readWorkspaceFile(ctx.workspaceRoot, filePath)
      if (!read.ok) {return json({ error: read.error })}

      const parser = new RubyAstParser()
      const types = parser.parseTypeDefinitions(read.content)
      const targetType = findTargetType(types, method_name, class_name)
      if (!targetType) {
        return json({ error: `No enclosing type found for method "${method_name}" in ${filePath}` })
      }

      const method = targetType.methods.find(m => m.name === method_name)
      if (!method) {
        return json({ error: `Method "${method_name}" not found in ${targetType.name}` })
      }

      const calls = targetType.calls.filter(c => c.line >= method.startLine && c.line <= method.endLine)
      return json({
        filePath,
        className: targetType.name,
        method: {
          name: method.name,
          isPublic: method.isPublic,
          startLine: method.startLine,
          endLine: method.endLine,
          params: method.params,
          calls: calls.map(c => ({ receiver: c.receiver, method: c.method, line: c.line })),
        },
      })
    },
  }),

  defineTool({
    name: 'ruby_check_syntax',
    risk: 'R2',
    title: 'Check Ruby syntax',
    description: 'Checks Ruby code syntax using ruby -c (safe, parse-only). Returns ok or error message.',
    inputSchema: {
      code: z.string().describe('Ruby code snippet to validate'),
    },
    invocationMessage: 'Checking Ruby syntax',
    async handler(_ctx: ToolContext, { code }) {
      const result = await checkRubySyntax(code)
      if (result.status === 'ok') {
        return json({ valid: true, status: 'ok' })
      }
      if (result.status === 'error') {
        return json({ valid: false, status: 'error', message: result.message })
      }
      return json({ valid: null, status: 'unavailable', message: 'Ruby binary is not available to verify syntax' })
    },
  }),

  defineTool({
    name: 'ruby_get_project_capabilities',
    risk: 'R0',
    title: 'Get Ruby project capabilities',
    description: 'Detects active Ruby version, Rails version, test framework, linters, and type checkers for the project.',
    inputSchema: {},
    invocationMessage: 'Detecting project capabilities',
    async handler(ctx: ToolContext) {
      const detector = new EnvironmentDetector()
      const env = detector.detectEnvironment(ctx.workspaceRoot)
      const root = ctx.workspaceRoot

      return json({
        rubyVersion: env.rubyVersion,
        railsVersion: env.railsVersion,
        hasRails: env.hasRails,
        hasHotwire: env.hasHotwire,
        testFramework: env.testFramework,
        projectType: env.projectType,
        typeCheckers: {
          steep: fs.existsSync(path.join(root, 'Steepfile')),
          sorbet: fs.existsSync(path.join(root, 'sorbet', 'config')),
          rbs: fs.existsSync(path.join(root, 'sig')),
        },
        linters: {
          rubocop: fs.existsSync(path.join(root, '.rubocop.yml')),
          standard: fs.existsSync(path.join(root, '.standard.yml')),
        },
      })
    },
  }),
]
