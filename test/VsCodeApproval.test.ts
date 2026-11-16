// The editor's approval prompt for one R3 call, as a Quick Pick that can be dismissed from code. Only "Allow once" grants.
// Deny, Escape, hiding the prompt and the operation being cancelled all deny. The first answer wins, and a cancelled
// operation gets no prompt at all.
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface FakePick {
  title?: string
  placeholder?: string
  ignoreFocusOut?: boolean
  items: Array<{ label: string; detail?: string; answer: string }>
  selectedItems: Array<{ answer: string }>
  activeItems: Array<{ answer: string }>
  show: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  accept(item?: { answer: string }): void
  hideByUser(): void
}

const picks: FakePick[] = []

function newFakePick(): FakePick {
  let onAccept: (() => void) | undefined
  let onHide: (() => void) | undefined
  const pick: FakePick = {
    items: [],
    selectedItems: [],
    activeItems: [],
    show: vi.fn(),
    // Like the editor: hiding a Quick Pick also fires its hide event.
    hide: vi.fn(() => onHide?.()),
    dispose: vi.fn(),
    accept(item) {
      if (item) {pick.selectedItems = [item]}
      onAccept?.()
    },
    hideByUser() { onHide?.() },
  }
  Object.assign(pick, {
    onDidAccept: (fn: () => void) => { onAccept = fn; return { dispose() {} } },
    onDidHide: (fn: () => void) => { onHide = fn; return { dispose() {} } },
  })
  picks.push(pick)
  return pick
}

const createFailure = vi.hoisted(() => ({ next: false }))

vi.mock('vscode', () => ({
  window: {
    createQuickPick: () => {
      if (createFailure.next) {
        createFailure.next = false
        throw new Error('no window')
      }
      return newFakePick()
    },
  },
}))

import { vscodeApprovalPort } from '../src/mcp/external/VsCodeApproval'
import type { ApprovalRequest } from '../src/mcp/policy/ToolInvocation'

const request = {
  tool: 'ask-ruby__run_command',
  risk: 'R3',
  source: 'host',
  workspaceRoot: '/work/shop',
  operation: 'ask-ruby: run_command',
  argumentNames: ['command', 'timeout'],
  argumentPreview: '{"command":"bin/rails db:reset","timeout":30}',
} as ApprovalRequest

const allowOnce = (pick: FakePick) => pick.items.find(item => item.answer === 'granted')!
const deny = (pick: FakePick) => pick.items.find(item => item.answer === 'denied')!

describe('the approval prompt', () => {
  beforeEach(() => {
    picks.length = 0
  })

  it('grants the call only when the user accepts "Allow once"', async () => {
    const decided = vscodeApprovalPort().request(request)
    const pick = picks[0]
    pick.accept(allowOnce(pick))
    await expect(decided).resolves.toBe('granted')
  })

  it('denies when the user accepts "Deny"', async () => {
    const decided = vscodeApprovalPort().request(request)
    const pick = picks[0]
    pick.accept(deny(pick))
    await expect(decided).resolves.toBe('denied')
  })

  it('denies when the user hides the prompt (Escape, or a click away)', async () => {
    const decided = vscodeApprovalPort().request(request)
    picks[0].hideByUser()
    await expect(decided).resolves.toBe('denied')
  })

  it('puts Deny first, so Enter denies by default, and keeps the prompt open when focus moves', async () => {
    void vscodeApprovalPort().request(request)
    expect(picks[0].items[0].answer).toBe('denied')
    expect(picks[0].ignoreFocusOut).toBe(true)
  })

  it('hides and disposes the prompt when the operation is cancelled while it is open, and denies', async () => {
    const controller = new AbortController()
    const decided = vscodeApprovalPort().request(request, controller.signal)
    controller.abort()
    await expect(decided).resolves.toBe('denied')
    expect(picks[0].hide).toHaveBeenCalled()
    expect(picks[0].dispose).toHaveBeenCalled()
  })

  it('a click on "Allow once" after the cancellation is ignored: the answer is denied, and the prompt is gone', async () => {
    const controller = new AbortController()
    const decided = vscodeApprovalPort().request(request, controller.signal)
    const pick = picks[0]
    controller.abort()
    pick.accept(allowOnce(pick))
    await expect(decided).resolves.toBe('denied')
  })

  it('the first answer wins: a second answer after the prompt closed changes nothing', async () => {
    const decided = vscodeApprovalPort().request(request)
    const pick = picks[0]
    pick.accept(deny(pick))
    pick.accept(allowOnce(pick))
    pick.hideByUser()
    await expect(decided).resolves.toBe('denied')
    expect(pick.dispose).toHaveBeenCalledTimes(1)
  })

  it('shows no prompt at all for an operation that is already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(vscodeApprovalPort().request(request, controller.signal)).resolves.toBe('denied')
    expect(picks).toHaveLength(0)
  })

  it('shows the tool, its risk, the workspace, the operation, the argument names and their values', async () => {
    void vscodeApprovalPort().request(request)
    const pick = picks[0]
    expect(pick.title).toContain('"ask-ruby__run_command" (risk R3)')
    expect(pick.placeholder).toContain('Workspace: /work/shop')
    expect(pick.placeholder).toContain('Operation: ask-ruby: run_command')
    expect(allowOnce(pick).detail).toBe('Arguments (command, timeout): {"command":"bin/rails db:reset","timeout":30}')
    expect(pick.show).toHaveBeenCalled()
  })

  it('says so when the call has no arguments', async () => {
    void vscodeApprovalPort().request({ ...request, argumentNames: [], argumentPreview: '{}' } as ApprovalRequest)
    expect(allowOnce(picks[0]).detail).toBe('Arguments (none): {}')
  })

  it('rejects when the editor cannot show the prompt, so the caller treats the call as not approved', async () => {
    createFailure.next = true
    await expect(vscodeApprovalPort().request(request)).rejects.toThrow('no window')
    expect(picks).toHaveLength(0)
  })
})
