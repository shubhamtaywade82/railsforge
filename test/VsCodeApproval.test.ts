// The editor's approval prompt for one R3 call. Only "Allow once" grants; closing the prompt denies; a prompt that fails
// is an error for the caller to treat as not approved. The modal names what is being allowed.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const showWarningMessage = vi.fn()

vi.mock('vscode', () => ({
  window: { showWarningMessage: (...args: unknown[]) => showWarningMessage(...args) },
}))

import { vscodeApprovalPort } from '../src/mcp/external/VsCodeApproval'
import type { ApprovalRequest } from '../src/mcp/policy/ToolInvocation'

const request: ApprovalRequest = {
  tool: 'ask-ruby__run_command',
  risk: 'R3',
  source: 'host',
  workspaceRoot: '/work/shop',
  operation: 'ask-ruby: run_command',
  argumentNames: ['command', 'timeout'],
  argumentPreview: '{"command":"bin/rails db:reset","timeout":30}',
} as ApprovalRequest

describe('the approval prompt', () => {
  beforeEach(() => {
    showWarningMessage.mockReset()
  })

  it('grants the call only when the user chooses "Allow once"', async () => {
    showWarningMessage.mockResolvedValueOnce('Allow once')
    await expect(vscodeApprovalPort().request(request)).resolves.toBe('granted')
  })

  it('denies when the user closes the prompt', async () => {
    showWarningMessage.mockResolvedValueOnce(undefined)
    await expect(vscodeApprovalPort().request(request)).resolves.toBe('denied')
  })

  it('denies for any other answer', async () => {
    showWarningMessage.mockResolvedValueOnce('Always allow')
    await expect(vscodeApprovalPort().request(request)).resolves.toBe('denied')
  })

  it('denies when the operation was cancelled while the prompt was open, even if the user then clicks "Allow once"', async () => {
    let answer: (value: string | undefined) => void = () => undefined
    showWarningMessage.mockImplementationOnce(() => new Promise(resolve => { answer = resolve }))
    const controller = new AbortController()
    const decided = vscodeApprovalPort().request(request, controller.signal)

    controller.abort()
    answer('Allow once')
    await expect(decided).resolves.toBe('denied')
  })

  it('shows a modal that names the tool, its risk, the workspace, the operation, the argument names and their values', async () => {
    showWarningMessage.mockResolvedValueOnce(undefined)
    await vscodeApprovalPort().request(request)

    const [message, options, button] = showWarningMessage.mock.calls[0]
    expect(options).toEqual({ modal: true })
    expect(button).toBe('Allow once')
    expect(message).toContain('RailsForge wants to run "ask-ruby__run_command" (risk R3).')
    expect(message).toContain('Workspace: /work/shop')
    expect(message).toContain('Operation: ask-ruby: run_command')
    expect(message).toContain('Arguments (command, timeout): {"command":"bin/rails db:reset","timeout":30}')
  })

  it('says so when the call has no arguments', async () => {
    showWarningMessage.mockResolvedValueOnce(undefined)
    await vscodeApprovalPort().request({ ...request, argumentNames: [], argumentPreview: '{}' } as ApprovalRequest)
    expect(showWarningMessage.mock.calls[0][0]).toContain('Arguments (none): {}')
  })

  it('rejects when the editor cannot show the prompt, so the caller treats the call as not approved', async () => {
    showWarningMessage.mockRejectedValueOnce(new Error('no window'))
    await expect(vscodeApprovalPort().request(request)).rejects.toThrow('no window')
  })
})
