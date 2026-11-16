/**
 * VsCodeApproval - the host's prompt for a single R3 call. It is a modal, and it names the tool, the workspace, the
 * operation and the arguments, so the person approving knows what they are allowing. Only "Allow once" grants; closing
 * the prompt, or any other answer, denies. A grant covers this one call: ToolInvocation asks again for the next one.
 *
 * Argument values are shown here, to the person approving, and nowhere else. The audit trail records names only.
 */

import * as vscode from 'vscode'
import type { ApprovalPort } from '../policy/ToolInvocation'

const ALLOW_ONCE = 'Allow once'

export function vscodeApprovalPort(): ApprovalPort {
  return {
    request: async (request, signal) => {
      const message = [
        `RailsForge wants to run "${request.tool}" (risk ${request.risk}).`,
        `Workspace: ${request.workspaceRoot}`,
        `Operation: ${request.operation}`,
        `Arguments (${request.argumentNames.join(', ') || 'none'}): ${request.argumentPreview}`,
      ].join('\n')
      const choice = await vscode.window.showWarningMessage(message, { modal: true }, ALLOW_ONCE)
      if (signal?.aborted) {return 'denied'}
      return choice === ALLOW_ONCE ? 'granted' : 'denied'
    },
  }
}
