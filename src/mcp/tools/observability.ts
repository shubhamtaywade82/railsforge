/**
 * Observability MCP Tools - log inspection, secret redaction, and request performance metrics.
 * vscode-free; reads bounded log tails without buffering huge files.
 */

import * as fs from 'fs'
import * as path from 'path'
import { z } from 'zod'
import { resolveWithinRoot } from '../../util/WorkspacePath'
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

const SECRET_REPLACERS: Array<{ pattern: RegExp; replace: string }> = [
  {
    pattern: /("(?:password|password_confirmation|token|secret|api_key|access_token|credit_card)":\s*")[^"]*(")/gi,
    replace: '$1[FILTERED]$2',
  },
  {
    pattern: /(["']?(?:password|password_confirmation|token|secret|api_key|access_token|credit_card)["']?\s*=>\s*)[^,\s}]+/gi,
    replace: '$1[FILTERED]',
  },
  {
    pattern: /(Bearer\s+)[\w.-]+/gi,
    replace: '$1[FILTERED]',
  },
  {
    pattern: /((?:Authorization|X-Api-Key):\s*)[\S]+/gi,
    replace: '$1[FILTERED]',
  },
]

export function redactSecrets(line: string): string {
  let result = line
  for (const { pattern, replace } of SECRET_REPLACERS) {
    result = result.replace(pattern, replace)
  }
  return result
}

export function readTailLines(filePath: string, maxLines: number, maxBytes = 128 * 1024): string[] {
  if (!fs.existsSync(filePath)) {return []}
  const size = fs.statSync(filePath).size
  if (size === 0) {return []}

  const bytesToRead = Math.min(size, maxBytes)
  const buffer = Buffer.alloc(bytesToRead)
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.readSync(fd, buffer, 0, bytesToRead, size - bytesToRead)
  } finally {
    fs.closeSync(fd)
  }

  const lines = buffer.toString('utf8').split(/\r?\n/)
  // Drop partial leading line when we read from the middle of the file
  const clean = size > bytesToRead ? lines.slice(1) : lines
  return clean.slice(-maxLines)
}

interface RequestMetric {
  status: number
  durationMs: number
  dbTimeMs?: number
  viewTimeMs?: number
}

function parseLogMetrics(lines: readonly string[]): { requests: RequestMetric[]; errorCount: number } {
  const requests: RequestMetric[] = []
  let errorCount = 0

  for (const line of lines) {
    if (/Completed 5\d\d|Error\s*\([A-Z]|FATAL\s*--/.test(line)) {
      errorCount++
    }
    const m = /Completed (\d{3}) \w+ in ([\d.]+)ms(?:.*Views: ([\d.]+)ms)?(?:.*ActiveRecord: ([\d.]+)ms)?/.exec(line)
    if (m) {
      requests.push({
        status: Number(m[1]),
        durationMs: Number(m[2]),
        viewTimeMs: m[3] ? Number(m[3]) : undefined,
        dbTimeMs: m[4] ? Number(m[4]) : undefined,
      })
    }
  }
  return { requests, errorCount }
}

export const OBSERVABILITY_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: 'ruby_read_log',
    risk: 'R1',
    title: 'Read Rails log file',
    description: 'Reads recent lines from development or test logs with automatic secret redaction and request/SQL metrics.',
    inputSchema: {
      environment: z.enum(['development', 'test']).optional().describe('Log environment to read (default: "development")'),
      lines: z.number().optional().describe('Number of lines to read from end of file (1-200, default 50)'),
      filter: z.string().optional().describe('Optional substring filter (e.g. "error", "ActiveRecord", "OrdersController")'),
    },
    invocationMessage: 'Reading Rails log',
    async handler(ctx: ToolContext, { environment = 'development', lines = 50, filter }) {
      const relPath = path.posix.join('log', `${environment}.log`)
      const resolved = resolveWithinRoot(ctx.workspaceRoot, relPath)
      if (!resolved.ok) {return json({ error: `Invalid path: ${resolved.reason}` })}
      if (!fs.existsSync(resolved.fullPath)) {return json({ error: `Log file not found: ${relPath}` })}

      const lineLimit = Math.min(Math.max(1, lines), 200)
      const rawLines = readTailLines(resolved.fullPath, lineLimit * 2)
      const redacted = rawLines.map(redactSecrets)
      const filtered = filter ? redacted.filter(l => l.toLowerCase().includes(filter.toLowerCase())) : redacted
      const finalLines = filtered.slice(-lineLimit)
      const metrics = parseLogMetrics(finalLines)

      return json({
        logFile: relPath,
        lineCount: finalLines.length,
        summary: {
          requests: metrics.requests,
          detectedErrors: metrics.errorCount,
        },
        lines: finalLines,
      })
    },
  }),
]
