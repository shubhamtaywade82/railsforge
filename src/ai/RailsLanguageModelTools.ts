/**
 * RailsLanguageModelTools - exposes RailsForge's tools to VS Code's agent mode / chat as
 * native Language Model tools (`vscode.lm.registerTool`). Same handlers as the standalone MCP
 * server (src/mcp/tools), run in-process against the project that owns the active editor.
 */

import { RAILSFORGE_TOOLS, ToolDefinition } from '../mcp/tools/definitions'
import { ToolContext } from '../mcp/tools/ToolContext'
import { lmToolName } from '../mcp/tools/lmManifest'
import { PerRootRegistry } from '../workspace/PerRootRegistry'

const MAX_OUTPUT_CHARS = 60_000

/** The slice of the `vscode.lm` API used here (feature-detected at runtime; also what tests fake). */
export interface LmApiLike {
  registerTool(name: string, tool: {
    prepareInvocation?(options: unknown, token: unknown): { invocationMessage: string }
    invoke(options: { input: Record<string, unknown> }, token: unknown): Promise<unknown>
  }): { dispose(): void }
}

export interface LmToolRuntime {
  lm: LmApiLike
  /** Project root the tool should run against (the active editor's), if any. */
  getRoot(): string | undefined
  /** Supplies the per-root tool context (shared with the agent so graph/skills caches are reused). */
  createContext?(root: string): ToolContext
  /** Wraps text into a LanguageModelToolResult. */
  toResult(text: string): unknown
  log?(message: string): void
}

export function truncateForModel(text: string): string {
  return text.length <= MAX_OUTPUT_CHARS ? text : `${text.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated ${text.length - MAX_OUTPUT_CHARS} characters]`
}

export async function runTool(tool: ToolDefinition, ctx: ToolContext, input: Record<string, unknown>): Promise<string> {
  try {
    return truncateForModel(await tool.handler(ctx, input))
  } catch (err) {
    // Tool failures are reported to the model as text so it can adapt, never thrown into the chat.
    return `Error running ${tool.name}: ${err instanceof Error ? err.message : String(err)}`
  }
}

export function registerRailsLanguageModelTools(runtime: LmToolRuntime, tools: readonly ToolDefinition[] = RAILSFORGE_TOOLS): Array<{ dispose(): void }> {
  const contexts = new PerRootRegistry<ToolContext>(root => runtime.createContext?.(root) ?? new ToolContext(root))
  const disposables = tools.map(tool => runtime.lm.registerTool(lmToolName(tool), {
    prepareInvocation: () => ({ invocationMessage: tool.invocationMessage }),
    async invoke(options) {
      const root = runtime.getRoot()
      if (!root) {return runtime.toResult('No Ruby/Rails workspace folder is open, so this RailsForge tool has no project to read.')}
      runtime.log?.(`[lm-tool] ${tool.name}`)
      return runtime.toResult(await runTool(tool, contexts.get(root), options.input ?? {}))
    },
  }))
  return [...disposables, { dispose: () => contexts.retainOnly([]) }]
}
