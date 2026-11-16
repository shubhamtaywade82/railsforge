/**
 * McpResults - maps an invocation result to MCP's CallToolResult. Pure and vscode-free, so the response contract is tested
 * without a running server.
 *
 * Success: the text always, and structuredContent when the tool declares an output schema. The structured value is checked
 * against that schema here, so a mismatch is a coded tool error (OUTPUT_CONTRACT) rather than a protocol error.
 *
 * Failure: isError, the message as text, and the stable code in _meta.railsforge.code. A failed result has no
 * structuredContent, so the output schema is not applied to it. A transport failure never reaches this function: it is a
 * JSON-RPC error on the client side, and a client can tell it from a tool result that carries isError.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { InvocationResult } from './policy/ToolInvocation'

export function toCallToolResult(result: InvocationResult, outputSchema?: z.ZodRawShape): CallToolResult {
  if (!result.ok) {
    return { isError: true, content: [{ type: 'text', text: result.message }], _meta: { railsforge: { code: result.code } } }
  }
  if (!outputSchema) {
    return { content: [{ type: 'text', text: result.text }] }
  }
  if (result.data === undefined || !z.object(outputSchema).safeParse(result.data).success) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'RailsForge: this tool declares a structured result, and the value it produced does not match that declaration.' }],
      _meta: { railsforge: { code: 'OUTPUT_CONTRACT' } },
    }
  }
  return { content: [{ type: 'text', text: result.text }], structuredContent: result.data }
}
