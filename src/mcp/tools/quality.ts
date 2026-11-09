/**
 * Quality & Testing MCP Tools - test runner, affected test discovery, and linter.
 * Pure Node / toolchain backed (vscode-free).
 */

import * as fs from 'fs'
import * as path from 'path'
import { z } from 'zod'
import { execFileAsync } from '../../util/ProjectProcess'
import { rubyCandidates } from '../../util/RubyCommand'
import { resolveWithinRoot } from '../../util/WorkspacePath'
import { specCandidates } from '../../refactoring-intelligence/planning/PathGuard'
import { parseRspecJson } from '../../testing/TestResultParsers'
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

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function execRubyTool(root: string, tool: string, args: readonly string[]): Promise<ExecResult> {
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 60_000)
  try {
    for (const c of rubyCandidates(root, tool, args)) {
      try {
        const { stdout, stderr } = await execFileAsync(c.command, c.args, { cwd: root, maxBuffer: 20 * 1024 * 1024, signal: abort.signal })
        return { exitCode: 0, stdout, stderr }
      } catch (err: unknown) {
        const e = err as { code?: string | number; stdout?: string; stderr?: string; message?: string; name?: string }
        if (e.code === 'ENOENT') {continue}
        if (e.name === 'AbortError') {return { exitCode: 1, stdout: '', stderr: 'Execution timed out after 60s' }}
        return { exitCode: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '' }
      }
    }
    return { exitCode: 127, stdout: '', stderr: `Could not launch ${tool} (no binstub, bundle exec, or PATH binary found)` }
  } finally {
    clearTimeout(timeout)
  }
}

function findCandidatesForSource(root: string, filePath: string): string[] {
  const found = new Set<string>()
  for (const c of specCandidates(filePath)) {
    if (fs.existsSync(path.join(root, c))) {found.add(c)}
  }
  if (filePath.startsWith('app/controllers/')) {
    const base = path.basename(filePath, '_controller.rb')
    const reqSpec = `spec/requests/${base}_spec.rb`
    if (fs.existsSync(path.join(root, reqSpec))) {found.add(reqSpec)}
    const reqTest = `test/integration/${base}_test.rb`
    if (fs.existsSync(path.join(root, reqTest))) {found.add(reqTest)}
  }
  return [...found]
}

export const QUALITY_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: 'ruby_find_affected_tests',
    risk: 'R0',
    title: 'Find affected tests for file',
    description: 'Finds candidate spec/test files corresponding to a Ruby source file using project conventions and graph relationships.',
    inputSchema: {
      path: z.string().describe('Workspace-relative path to Ruby source file, e.g. "app/models/user.rb"'),
    },
    invocationMessage: 'Finding affected tests',
    async handler(ctx: ToolContext, { path: filePath }) {
      const resolved = resolveWithinRoot(ctx.workspaceRoot, filePath)
      if (!resolved.ok) {return json({ error: `Invalid path: ${resolved.reason}` })}

      const testFiles = findCandidatesForSource(ctx.workspaceRoot, filePath)
      return json({ filePath, testFiles })
    },
  }),

  defineTool({
    name: 'ruby_run_tests',
    risk: 'R2',
    title: 'Run Ruby tests',
    description: 'Executes targeted spec or test file (optionally with line number) using project binstub (rspec or rails test).',
    inputSchema: {
      path: z.string().describe('Workspace-relative path to test file, e.g. "spec/models/user_spec.rb"'),
      line: z.number().optional().describe('Optional 1-based line number of specific example/test'),
    },
    invocationMessage: 'Running tests',
    async handler(ctx: ToolContext, { path: filePath, line }) {
      const resolved = resolveWithinRoot(ctx.workspaceRoot, filePath)
      if (!resolved.ok) {return json({ error: `Invalid path: ${resolved.reason}` })}
      if (!fs.existsSync(resolved.fullPath)) {return json({ error: `File not found: ${filePath}` })}

      const isRspec = filePath.endsWith('_spec.rb') || filePath.startsWith('spec/')
      const target = line ? `${filePath}:${line}` : filePath
      const tool = isRspec ? 'rspec' : 'rails'
      const args = isRspec ? ['--format', 'json', target] : ['test', target]

      const result = await execRubyTool(ctx.workspaceRoot, tool, args)
      if (result.exitCode === 127) {return json({ error: result.stderr })}

      if (isRspec) {
        const parsed = parseRspecJson(result.stdout)
        if (parsed) {
          const failed = parsed.filter(e => e.status === 'failed')
          return json({
            target,
            framework: 'rspec',
            status: failed.length === 0 ? 'passed' : 'failed',
            summary: { total: parsed.length, passed: parsed.length - failed.length, failed: failed.length },
            failures: failed.map(f => ({ description: f.fullDescription, line: f.line, message: f.failure?.message })),
          })
        }
      }

      return json({
        target,
        framework: isRspec ? 'rspec' : 'minitest',
        status: result.exitCode === 0 ? 'passed' : 'failed',
        rawOutput: (result.stdout + '\n' + result.stderr).trim().slice(0, 10_000),
      })
    },
  }),

  defineTool({
    name: 'ruby_run_linter',
    risk: 'R2',
    title: 'Run Ruby linter',
    description: 'Runs project linter (RuboCop or Standard) on a target file with JSON formatting, returning structured offenses.',
    inputSchema: {
      path: z.string().describe('Workspace-relative path to file to lint, e.g. "app/models/user.rb"'),
      autocorrect: z.boolean().optional().describe('Whether to apply safe autocorrect (-a)'),
    },
    invocationMessage: 'Running Ruby linter',
    async handler(ctx: ToolContext, { path: filePath, autocorrect }) {
      const resolved = resolveWithinRoot(ctx.workspaceRoot, filePath)
      if (!resolved.ok) {return json({ error: `Invalid path: ${resolved.reason}` })}
      if (!fs.existsSync(resolved.fullPath)) {return json({ error: `File not found: ${filePath}` })}

      const root = ctx.workspaceRoot
      const isStandard = !fs.existsSync(path.join(root, '.rubocop.yml')) && fs.existsSync(path.join(root, '.standard.yml'))
      const tool = isStandard ? 'standardrb' : 'rubocop'
      const args = ['--format', 'json', ...(autocorrect ? ['-a'] : []), filePath]

      const result = await execRubyTool(root, tool, args)
      if (result.exitCode === 127) {return json({ error: result.stderr })}

      try {
        const parsed = JSON.parse(result.stdout) as { files?: Array<{ offenses?: Array<{ cop_name: string; message: string; severity: string; correctable: boolean; location: unknown }> }> }
        const offenses = parsed.files?.[0]?.offenses ?? []
        return json({
          filePath,
          tool,
          status: offenses.length === 0 ? 'clean' : 'offenses_found',
          offenseCount: offenses.length,
          offenses: offenses.map(o => ({ cop: o.cop_name, message: o.message, severity: o.severity, correctable: o.correctable, location: o.location })),
        })
      } catch {
        return json({ filePath, tool, status: result.exitCode === 0 ? 'clean' : 'offenses_found', rawOutput: (result.stdout + '\n' + result.stderr).trim().slice(0, 5_000) })
      }
    },
  }),
]
