import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from 'vscode'
import { RailsChatParticipant } from '../src/chat/RailsChatParticipant'
import { RailsAgent } from '../src/agent/RailsAgent'
import { SchemaIndexer } from '../src/rails/SchemaIndexer'
import { RoutesIndexer } from '../src/routes/RoutesIndexer'

vi.mock('../src/util/Logger', () => ({
  Logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const mockAgent = {
  run: vi.fn(),
} as unknown as RailsAgent

const mockSchemaIndexer = {
  getAllTables: vi.fn().mockReturnValue([]),
} as unknown as SchemaIndexer

const mockRoutesIndexer = {
  getAllRoutes: vi.fn().mockReturnValue([]),
} as unknown as RoutesIndexer

beforeEach(() => {
  vi.clearAllMocks()
  RailsChatParticipant['instance'] = undefined
})

describe('RailsChatParticipant', () => {
  it('getInstance returns a singleton', () => {
    const a = RailsChatParticipant.getInstance()
    const b = RailsChatParticipant.getInstance()
    expect(a).toBe(b)
  })

  it('register is a no-op when vscode.chat is unavailable', () => {
    const participant = RailsChatParticipant.getInstance()
    const origChat = vscode.chat
    delete (vscode as any).chat
    expect(() => participant.register({ subscriptions: [] } as any, mockAgent, mockSchemaIndexer, mockRoutesIndexer)).not.toThrow()
    vscode.chat = origChat
  })

  it('register creates a chat participant and pushes to subscriptions', () => {
    let capturedHandler: any = null
    vi.spyOn(vscode.chat, 'createChatParticipant').mockImplementation((_id: string, handler: any) => {
      capturedHandler = handler
      return { dispose: vi.fn() }
    })
    const subs: any[] = []
    const participant = RailsChatParticipant.getInstance()
    participant.register({ subscriptions: subs } as any, mockAgent, mockSchemaIndexer, mockRoutesIndexer)
    expect(vscode.chat.createChatParticipant).toHaveBeenCalledWith('railsforge.agent', expect.any(Function))
    expect(subs.length).toBe(1)
  })

  it('handleRequest streams progress, calls agent, and streams response', async () => {
    let capturedHandler: any = null
    vi.spyOn(vscode.chat, 'createChatParticipant').mockImplementation((_id: string, handler: any) => {
      capturedHandler = handler
      return { dispose: vi.fn() }
    })
    const participant = RailsChatParticipant.getInstance()
    participant.register({ subscriptions: [] } as any, mockAgent, mockSchemaIndexer, mockRoutesIndexer)

    const progressCalls: string[] = []
    const markdownCalls: string[] = []
    const buttonCalls: any[] = []
    const stream = {
      progress: (t: string) => progressCalls.push(t),
      markdown: (m: string) => markdownCalls.push(m),
      button: (b: any) => buttonCalls.push(b),
    }

    vi.mocked(mockAgent.run).mockResolvedValue({
      success: true,
      response: 'Here is the answer',
      iterations: 1,
    })
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      value: undefined,
      configurable: true,
    })

    await capturedHandler(
      { prompt: 'explain associations', command: undefined },
      {},
      stream,
    )

    expect(progressCalls).toContain('RailsForge AI is analyzing...')
    expect(markdownCalls).toContain('Here is the answer')
    expect(vi.mocked(mockAgent.run)).toHaveBeenCalledWith('explain associations', expect.objectContaining({
      fileContent: undefined,
      selection: undefined,
      fileName: undefined,
      workspaceRoot: '/test/workspace',
    }))
  })

  it('handleRequest shows Apply Diff button when response contains diff', async () => {
    let capturedHandler: any = null
    vi.spyOn(vscode.chat, 'createChatParticipant').mockImplementation((_id: string, handler: any) => {
      capturedHandler = handler
      return { dispose: vi.fn() }
    })
    const participant = RailsChatParticipant.getInstance()
    participant.register({ subscriptions: [] } as any, mockAgent, mockSchemaIndexer, mockRoutesIndexer)

    const buttonCalls: any[] = []
    const stream = {
      progress: () => {},
      markdown: () => {},
      button: (b: any) => buttonCalls.push(b),
    }

    const doc = new vscode.TextDocument('/test/workspace/app/models/user.rb', 'ruby', 'class User\nend')
    const editor = { document: doc, selection: new vscode.Selection(0, 0, 0, 0) }
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: editor, configurable: true })

    vi.mocked(mockAgent.run).mockResolvedValue({
      success: true,
      response: '@@ -1 +1 @@\n-class User\n+class Admin',
      iterations: 1,
    })

    await capturedHandler(
      { prompt: 'rename class', command: 'fix' },
      {},
      stream,
    )

    expect(buttonCalls.length).toBe(1)
    expect(buttonCalls[0].title).toBe('Apply Diff')
    expect(buttonCalls[0].command).toBe('railsforge.applyChatResponse')
  })

  it('handleRequest shows Apply Changes button when response has code blocks but no diff', async () => {
    let capturedHandler: any = null
    vi.spyOn(vscode.chat, 'createChatParticipant').mockImplementation((_id: string, handler: any) => {
      capturedHandler = handler
      return { dispose: vi.fn() }
    })
    const participant = RailsChatParticipant.getInstance()
    participant.register({ subscriptions: [] } as any, mockAgent, mockSchemaIndexer, mockRoutesIndexer)

    const buttonCalls: any[] = []
    const stream = {
      progress: () => {},
      markdown: () => {},
      button: (b: any) => buttonCalls.push(b),
    }

    const doc = new vscode.TextDocument('/test/workspace/app/models/user.rb', 'ruby', 'class User\nend')
    const editor = { document: doc, selection: new vscode.Selection(0, 0, 0, 0) }
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: editor, configurable: true })

    vi.mocked(mockAgent.run).mockResolvedValue({
      success: true,
      response: 'Here is the code:\n\n\x60\x60\x60ruby\ndef foo\nend\n\x60\x60\x60',
      iterations: 1,
    })

    await capturedHandler(
      { prompt: 'add method', command: undefined },
      {},
      stream,
    )

    expect(buttonCalls.length).toBe(1)
    expect(buttonCalls[0].title).toBe('Apply Changes')
  })

  it('handleRequest does not show button when no editor is active', async () => {
    let capturedHandler: any = null
    vi.spyOn(vscode.chat, 'createChatParticipant').mockImplementation((_id: string, handler: any) => {
      capturedHandler = handler
      return { dispose: vi.fn() }
    })
    const participant = RailsChatParticipant.getInstance()
    participant.register({ subscriptions: [] } as any, mockAgent, mockSchemaIndexer, mockRoutesIndexer)

    const buttonCalls: any[] = []
    const stream = {
      progress: () => {},
      markdown: () => {},
      button: (b: any) => buttonCalls.push(b),
    }

    Object.defineProperty(vscode.window, 'activeTextEditor', { value: undefined, configurable: true })

    vi.mocked(mockAgent.run).mockResolvedValue({
      success: true,
      response: '@@ -1 +1 @@\n-old\n+new',
      iterations: 1,
    })

    await capturedHandler(
      { prompt: 'fix it', command: 'fix' },
      {},
      stream,
    )

    expect(buttonCalls.length).toBe(0)
  })

  it('handleRequest does not show button when agent fails', async () => {
    let capturedHandler: any = null
    vi.spyOn(vscode.chat, 'createChatParticipant').mockImplementation((_id: string, handler: any) => {
      capturedHandler = handler
      return { dispose: vi.fn() }
    })
    const participant = RailsChatParticipant.getInstance()
    participant.register({ subscriptions: [] } as any, mockAgent, mockSchemaIndexer, mockRoutesIndexer)

    const buttonCalls: any[] = []
    const stream = {
      progress: () => {},
      markdown: () => {},
      button: (b: any) => buttonCalls.push(b),
    }

    const doc = new vscode.TextDocument('/test/workspace/app/models/user.rb', 'ruby', 'class User\nend')
    const editor = { document: doc, selection: new vscode.Selection(0, 0, 0, 0) }
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: editor, configurable: true })

    vi.mocked(mockAgent.run).mockResolvedValue({
      success: false,
      response: 'Error: model unavailable',
      iterations: 0,
    })

    await capturedHandler(
      { prompt: 'generate code', command: undefined },
      {},
      stream,
    )

    expect(buttonCalls.length).toBe(0)
  })

  it('optimize command streams table count from schema', async () => {
    let capturedHandler: any = null
    vi.spyOn(vscode.chat, 'createChatParticipant').mockImplementation((_id: string, handler: any) => {
      capturedHandler = handler
      return { dispose: vi.fn() }
    })
    vi.mocked(mockSchemaIndexer.getAllTables).mockReturnValue([
      { name: 'users', columns: new Map([['id', { name: 'id', type: 'integer' }]]) },
      { name: 'posts', columns: new Map([['id', { name: 'id', type: 'integer' }]]) },
    ] as any)

    const participant = RailsChatParticipant.getInstance()
    participant.register({ subscriptions: [] } as any, mockAgent, mockSchemaIndexer, mockRoutesIndexer)

    const markdownCalls: string[] = []
    const stream = {
      progress: () => {},
      markdown: (m: string) => markdownCalls.push(m),
      button: () => {},
    }

    vi.mocked(mockAgent.run).mockResolvedValue({
      success: true,
      response: 'Optimized!',
      iterations: 1,
    })

    await capturedHandler(
      { prompt: 'optimize queries', command: 'optimize' },
      {},
      stream,
    )

    expect(markdownCalls.some(m => m.includes('2'))).toBe(true)
  })

  it('migrate command streams migration header', async () => {
    let capturedHandler: any = null
    vi.spyOn(vscode.chat, 'createChatParticipant').mockImplementation((_id: string, handler: any) => {
      capturedHandler = handler
      return { dispose: vi.fn() }
    })

    const participant = RailsChatParticipant.getInstance()
    participant.register({ subscriptions: [] } as any, mockAgent, mockSchemaIndexer, mockRoutesIndexer)

    const markdownCalls: string[] = []
    const stream = {
      progress: () => {},
      markdown: (m: string) => markdownCalls.push(m),
      button: () => {},
    }

    vi.mocked(mockAgent.run).mockResolvedValue({
      success: true,
      response: 'Migration code here',
      iterations: 1,
    })

    await capturedHandler(
      { prompt: 'add email to users', command: 'migrate' },
      {},
      stream,
    )

    expect(markdownCalls.some(m => m.includes('Migration'))).toBe(true)
  })

  it('button arguments include uri string and command', async () => {
    let capturedHandler: any = null
    vi.spyOn(vscode.chat, 'createChatParticipant').mockImplementation((_id: string, handler: any) => {
      capturedHandler = handler
      return { dispose: vi.fn() }
    })
    const participant = RailsChatParticipant.getInstance()
    participant.register({ subscriptions: [] } as any, mockAgent, mockSchemaIndexer, mockRoutesIndexer)

    const buttonCalls: any[] = []
    const stream = {
      progress: () => {},
      markdown: () => {},
      button: (b: any) => buttonCalls.push(b),
    }

    const doc = new vscode.TextDocument('/test/workspace/app/models/user.rb', 'ruby', 'code')
    const editor = { document: doc, selection: new vscode.Selection(0, 0, 0, 0) }
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: editor, configurable: true })

    vi.mocked(mockAgent.run).mockResolvedValue({
      success: true,
      response: '@@ -1 +1 @@\n-old\n+new',
      iterations: 1,
    })

    await capturedHandler(
      { prompt: 'fix', command: 'fix' },
      {},
      stream,
    )

    expect(buttonCalls[0].arguments[1]).toBe('/test/workspace/app/models/user.rb')
    expect(buttonCalls[0].arguments[2]).toBe('fix')
  })
})
