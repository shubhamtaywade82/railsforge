/**
 * VsCodeApproval - the host's prompt for a single R3 call. It is a Quick Pick, not a modal message, because the editor can
 * hide a Quick Pick from code. When the operation is cancelled, or the wait for an answer ends, the signal aborts and the
 * prompt is hidden at once, so a Stop never leaves a question on screen that no longer matters.
 *
 * Only "Allow once" grants, and it covers this one call; ToolInvocation asks again for the next one. Deny is the first
 * item, so Enter denies. Escape, hiding the prompt, and the signal aborting all deny. The first answer wins: an answer
 * that arrives after the prompt has closed is ignored.
 *
 * Argument values are shown here, to the person approving, and nowhere else. The audit trail records names only.
 */

import * as vscode from 'vscode'
import type { ApprovalAnswer, ApprovalPort, ApprovalRequest } from '../policy/ToolInvocation'

interface ApprovalItem extends vscode.QuickPickItem {
  readonly answer: ApprovalAnswer
}

/** Prompts on screen now. Read by the Extension Host tests, which need to know when a prompt is open. */
let openPrompts = 0
export function openApprovalPrompts(): number {
  return openPrompts
}

export function vscodeApprovalPort(): ApprovalPort {
  return {
    request: (request, signal) => new Promise<ApprovalAnswer>(resolve => {
      if (signal?.aborted) {
        resolve('denied')
        return
      }
      const pick = vscode.window.createQuickPick<ApprovalItem>()
      let answered = false
      const finish = (answer: ApprovalAnswer): void => {
        if (answered) {return}
        answered = true
        openPrompts--
        signal?.removeEventListener('abort', onAbort)
        resolve(answer)
        pick.hide()
        pick.dispose()
      }
      const onAbort = (): void => finish('denied')

      pick.title = `RailsForge wants to run "${request.tool}" (risk ${request.risk})`
      pick.placeholder = `Workspace: ${request.workspaceRoot} · Operation: ${request.operation}`
      pick.ignoreFocusOut = true
      pick.items = [
        { label: '$(x) Deny', detail: 'Do not run this call.', answer: 'denied' },
        { label: '$(check) Allow once', detail: argumentSummary(request), answer: 'granted' },
      ]
      pick.onDidAccept(() => {
        const chosen = pick.selectedItems[0] ?? pick.activeItems[0]
        finish(chosen?.answer === 'granted' ? 'granted' : 'denied')
      })
      pick.onDidHide(() => finish('denied'))
      signal?.addEventListener('abort', onAbort, { once: true })
      openPrompts++
      pick.show()
    }),
  }
}

/** The names and values of the arguments, for the person approving. The values are shown here and nowhere else. */
function argumentSummary(request: ApprovalRequest): string {
  const names = request.argumentNames.join(', ') || 'none'
  return `Arguments (${names}): ${request.argumentPreview}`
}
