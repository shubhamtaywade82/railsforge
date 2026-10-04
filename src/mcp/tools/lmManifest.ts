/**
 * Builds package.json's `contributes.languageModelTools` entries from the shared tool
 * definitions, so the manifest can never drift from the implementation (see the sync test).
 */

import { z } from 'zod'
import { ToolDefinition } from './definitions'

export const LM_TOOL_PREFIX = 'railsforge_'

export interface LmToolManifestEntry {
  name: string
  displayName: string
  toolReferenceName: string
  canBeReferencedInPrompt: true
  modelDescription: string
  userDescription: string
  tags: string[]
  inputSchema: Record<string, unknown>
}

export function lmToolName(tool: Pick<ToolDefinition, 'name'>): string {
  return `${LM_TOOL_PREFIX}${tool.name}`
}

export function buildLanguageModelToolManifest(tools: readonly ToolDefinition[]): LmToolManifestEntry[] {
  return tools.map(tool => {
    const schema = z.toJSONSchema(z.object(tool.inputSchema)) as Record<string, unknown>
    delete schema.$schema
    return {
      name: lmToolName(tool),
      displayName: tool.title,
      toolReferenceName: tool.name,
      canBeReferencedInPrompt: true,
      modelDescription: tool.description,
      userDescription: tool.title,
      tags: ['rails', 'ruby', 'railsforge'],
      inputSchema: schema,
    }
  })
}
