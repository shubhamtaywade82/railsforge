/**
 * LoopTools - the read-only subset of the shared RailsForge tools the bounded agent loop may call.
 * An explicit allowlist (not "everything except..."): a tool added to the shared set is NOT available
 * to the loop until someone decides it is read-only, local and cheap and adds it here.
 */

import { RAILSFORGE_TOOLS, ToolDefinition } from '../mcp/tools/definitions'
import { ToolContext } from '../mcp/tools/ToolContext'
import { truncateForModel } from '../ai/RailsLanguageModelTools'
import { LoopTool } from './AgentLoop'

export const READ_ONLY_LOOP_TOOLS: readonly string[] = [
  'get_schema', 'list_routes', 'list_patterns', 'find_similar_pattern', 'get_dependencies',
  'get_semantic_context', 'route_skills', 'list_skills', 'get_skill',
  'get_project_guidelines', 'get_example_file', 'list_rake_tasks', 'get_runtime_introspection',
]

export function createLoopTools(ctx: ToolContext, definitions: readonly ToolDefinition[] = RAILSFORGE_TOOLS, allow: readonly string[] = READ_ONLY_LOOP_TOOLS): LoopTool[] {
  return definitions
    .filter(def => allow.includes(def.name))
    .map(def => ({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      run: async args => truncateForModel(await def.handler(ctx, args)),
    }))
}
