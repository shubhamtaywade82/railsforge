// The approval prompt in a real editor. The prompt is a Quick Pick; these tests open it through the extension's test API and
// then drive it with the editor's own keyboard commands, so what is checked is what the editor does, not a mock of it.
// The test API only shows the prompt and reports the answer: it runs no tool.
import * as assert from 'assert'
import * as vscode from 'vscode'

interface ApprovalRequestLike {
  requestId: string
  tool: string
  risk: string
  source: string
  workspaceRoot: string
  operation: string
  argumentNames: string[]
  argumentPreview: string
}

interface ApprovalTestApi {
  requestApprovalForTest(request: ApprovalRequestLike, signal?: AbortSignal): Promise<'granted' | 'denied'>
  openApprovalPromptsForTest(): number
}

const EXTENSION_ID = 'ShubhamTaywade.railsforge'
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function api(): Promise<ApprovalTestApi> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID)
  assert.ok(extension, 'RailsForge is installed in the test host')
  await extension.activate()
  const exported = extension.exports as Partial<ApprovalTestApi>
  assert.ok(exported.requestApprovalForTest && exported.openApprovalPromptsForTest, 'the approval test hooks are present in test mode')
  return exported as ApprovalTestApi
}

function request(tool = 'ask-ruby__run_command'): ApprovalRequestLike {
  return {
    requestId: `req-${tool}-${Math.random().toString(36).slice(2)}`,
    tool,
    risk: 'R3',
    source: 'host',
    workspaceRoot: '/work/shop',
    operation: 'ask-ruby: run_command',
    argumentNames: ['command'],
    argumentPreview: '{"command":"bin/rails db:reset"}',
  }
}

/** Waits until the prompt is on screen, then lets the editor render it, before any key is sent to it. */
async function untilShown(a: ApprovalTestApi, count = 1): Promise<void> {
  const start = Date.now()
  while (a.openApprovalPromptsForTest() < count) {
    if (Date.now() - start > 10_000) {throw new Error('the approval prompt did not open')}
    await sleep(50)
  }
  await sleep(300)
}

async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {throw new Error('timed out waiting for the prompt to close')}
    await sleep(50)
  }
}

const key = (command: string): Thenable<unknown> => vscode.commands.executeCommand(command)
const SELECT_NEXT = 'workbench.action.quickOpenSelectNext'
const ACCEPT = 'workbench.action.acceptSelectedQuickOpenItem'
const CLOSE = 'workbench.action.closeQuickOpen'

describe('the approval prompt, in a real Extension Host', function () {
  this.timeout(60_000)

  let a: ApprovalTestApi

  before(async () => {
    a = await api()
  })

  // A failed test must not leave a prompt on screen for the next one.
  afterEach(async () => {
    if (a.openApprovalPromptsForTest() > 0) {
      await key(CLOSE)
      await until(() => a.openApprovalPromptsForTest() === 0)
    }
  })

  it('"Allow once", chosen by the user, grants this one call', async () => {
    const pending = a.requestApprovalForTest(request())
    await untilShown(a)
    await key(SELECT_NEXT)
    await key(ACCEPT)
    assert.strictEqual(await pending, 'granted')
    assert.strictEqual(a.openApprovalPromptsForTest(), 0)
  })

  it('Enter on the default choice denies, because Deny is the first item', async () => {
    const pending = a.requestApprovalForTest(request())
    await untilShown(a)
    await key(ACCEPT)
    assert.strictEqual(await pending, 'denied')
    assert.strictEqual(a.openApprovalPromptsForTest(), 0)
  })

  it('Escape closes the prompt and denies', async () => {
    const pending = a.requestApprovalForTest(request())
    await untilShown(a)
    await key(CLOSE)
    assert.strictEqual(await pending, 'denied')
    assert.strictEqual(a.openApprovalPromptsForTest(), 0)
  })

  it('a focus change does not close the prompt; it stays until the user answers it', async () => {
    const pending = a.requestApprovalForTest(request())
    await untilShown(a)
    await key('workbench.action.focusActiveEditorGroup')
    await sleep(500)
    assert.strictEqual(a.openApprovalPromptsForTest(), 1, 'the prompt is still open after focus moved')
    await key(SELECT_NEXT)
    await key(ACCEPT)
    assert.strictEqual(await pending, 'granted')
  })

  it('a Stop while the prompt is open closes it at once, and the call is denied', async () => {
    const controller = new AbortController()
    const pending = a.requestApprovalForTest(request(), controller.signal)
    await untilShown(a)
    const stoppedAt = Date.now()
    controller.abort()
    assert.strictEqual(await pending, 'denied')
    assert.ok(Date.now() - stoppedAt < 2_000, 'the answer came without waiting for the user')
    await until(() => a.openApprovalPromptsForTest() === 0)
  })

  it('an "Allow once" after the Stop cannot be given: the prompt has gone, so no key reaches it', async () => {
    const controller = new AbortController()
    const pending = a.requestApprovalForTest(request(), controller.signal)
    await untilShown(a)
    controller.abort()
    assert.strictEqual(await pending, 'denied')
    await until(() => a.openApprovalPromptsForTest() === 0)

    await key(SELECT_NEXT)
    await key(ACCEPT)
    await sleep(300)
    assert.strictEqual(a.openApprovalPromptsForTest(), 0, 'a late key press did not open or answer any prompt')
  })

  it('a Stop pressed more than once changes nothing after the first', async () => {
    const controller = new AbortController()
    const pending = a.requestApprovalForTest(request(), controller.signal)
    await untilShown(a)
    controller.abort()
    controller.abort()
    assert.strictEqual(await pending, 'denied')
    assert.strictEqual(a.openApprovalPromptsForTest(), 0)
  })

  it('a later, independent request gets its own prompt, and can be approved', async () => {
    const stopped = new AbortController()
    const first = a.requestApprovalForTest(request('ask-ruby__first'), stopped.signal)
    await untilShown(a)
    stopped.abort()
    assert.strictEqual(await first, 'denied')
    await until(() => a.openApprovalPromptsForTest() === 0)

    const second = a.requestApprovalForTest(request('ask-ruby__second'))
    await untilShown(a)
    await key(SELECT_NEXT)
    await key(ACCEPT)
    assert.strictEqual(await second, 'granted')
  })
})
