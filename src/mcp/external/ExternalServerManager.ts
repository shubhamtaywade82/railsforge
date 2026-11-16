/**
 * ExternalServerManager - owns the connections to external stdio MCP servers and their lifecycle.
 *
 * One session per (server id, project root). A multi-root workspace therefore gets one process per project, each
 * started in its own root. Sessions are created on first use, never at activation, so a window that does not use an
 * external server starts none.
 *
 *   - Nothing starts in an untrusted workspace (toolsFor refuses before any process is created).
 *   - Connect and list have a timeout. A session that fails, times out or whose process exits is marked failed, and it
 *     is not retried for `retryBackoffMs`, so a broken server cannot be restarted on every agent request.
 *   - A removed or changed server, or a disabled one, has its process closed. So does dispose().
 *   - A connection that finishes after its session was closed is closed again, so it cannot leak a process.
 *
 * The client and transport are injected, so the lifecycle is unit-tested without a process. The real SDK adapter is
 * SdkExternalClient.ts. vscode-free.
 */

import type { ExternalServerSpec } from './ExternalServerConfig'
import { ExposedExternalTool, RemoteToolDescriptor, exposeTools } from './ExternalTools'

export interface ExternalTransport {
  onclose?: () => void
  close(): Promise<void>
}

export interface ExternalClient {
  connect(transport: ExternalTransport): Promise<void>
  listTools(): Promise<RemoteToolDescriptor[]>
  /** `text` joins the server's text content. `isError` is the server's own report that the call failed. */
  callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<{ text: string; isError: boolean }>
  close(): Promise<void>
}

export interface TransportLaunch {
  command: string
  args: readonly string[]
  cwd: string
  env: Readonly<Record<string, string>>
}

export type LogLevel = 'info' | 'warn' | 'debug'

export interface ExternalServerManagerDeps {
  createClient(): Promise<ExternalClient>
  createTransport(launch: TransportLaunch): Promise<ExternalTransport>
  now?(): number
  log?(level: LogLevel, message: string): void
  connectTimeoutMs?: number
  callTimeoutMs?: number
  retryBackoffMs?: number
}

export interface ServerStatus {
  id: string
  state: 'ready' | 'failed' | 'disabled' | 'untrusted'
  tools: string[]
  problems: string[]
  failure?: string
}

interface Session {
  spec: ExternalServerSpec
  root: string
  fingerprint: string
  state: 'connecting' | 'ready' | 'failed'
  client?: ExternalClient
  transport?: ExternalTransport
  tools: ExposedExternalTool[]
  problems: string[]
  failure?: string
  failedAt?: number
  pending?: Promise<void>
  closed: boolean
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000
const DEFAULT_CALL_TIMEOUT_MS = 60_000
const DEFAULT_RETRY_BACKOFF_MS = 30_000

export class ExternalServerManager {
  private specs = new Map<string, ExternalServerSpec>()
  private readonly sessions = new Map<string, Session>()
  private readonly now: () => number
  private readonly connectTimeoutMs: number
  private readonly callTimeoutMs: number
  private readonly retryBackoffMs: number

  constructor(private readonly deps: ExternalServerManagerDeps) {
    this.now = deps.now ?? Date.now
    this.connectTimeoutMs = deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.callTimeoutMs = deps.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    this.retryBackoffMs = deps.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS
  }

  /** Replaces the configured servers. Sessions whose server was removed, disabled or changed are closed. */
  configure(specs: readonly ExternalServerSpec[]): void {
    const next = new Map(specs.map(spec => [spec.id, spec]))
    for (const [key, session] of [...this.sessions]) {
      const spec = next.get(session.spec.id)
      if (!spec || !spec.enabled || fingerprint(spec) !== session.fingerprint) {
        this.closeSession(key)
      }
    }
    this.specs = next
  }

  /** The tools the agent may use for `root`. Starts a server only when the workspace is trusted and the server is enabled. */
  async toolsFor(root: string, trusted: boolean): Promise<ExposedExternalTool[]> {
    if (!trusted) {return []}
    const enabled = [...this.specs.values()].filter(spec => spec.enabled)
    const perServer = await Promise.all(enabled.map(spec => this.ensureReady(spec, root)))
    return perServer.flat()
  }

  /** What each configured server is doing for `root`. Used by the test command, so it reports the state rather than hiding it. */
  async statusFor(root: string, trusted: boolean): Promise<ServerStatus[]> {
    return Promise.all([...this.specs.values()].map(async (spec): Promise<ServerStatus> => {
      if (!spec.enabled) {return { id: spec.id, state: 'disabled', tools: [], problems: [] }}
      if (!trusted) {return { id: spec.id, state: 'untrusted', tools: [], problems: [] }}
      await this.ensureReady(spec, root)
      const session = this.sessions.get(sessionKey(spec.id, root))
      if (session?.state === 'ready') {
        return { id: spec.id, state: 'ready', tools: session.tools.map(t => t.remoteName), problems: session.problems }
      }
      return { id: spec.id, state: 'failed', tools: [], problems: session?.problems ?? [], failure: session?.failure }
    }))
  }

  /** Calls one exposed tool on the session for `root`. Refuses a tool the session did not expose. */
  async callTool(serverId: string, root: string, remoteName: string, args: Record<string, unknown>): Promise<string> {
    const session = this.sessions.get(sessionKey(serverId, root))
    if (!session || session.state !== 'ready' || !session.client) {
      throw new Error(`${serverId} is not connected${session?.failure ? `: ${session.failure}` : ''}.`)
    }
    if (!session.tools.some(tool => tool.remoteName === remoteName)) {
      throw new Error(`${serverId} does not expose "${remoteName}".`)
    }
    const result = await session.client.callTool(remoteName, args, this.callTimeoutMs)
    if (result.isError) {throw new Error(result.text || `${serverId} reported an error.`)}
    return result.text
  }

  /** Closes every process. Safe to call more than once. */
  async dispose(): Promise<void> {
    const closing = [...this.sessions.keys()].map(key => this.closeSession(key))
    await Promise.all(closing)
  }

  private async ensureReady(spec: ExternalServerSpec, root: string): Promise<ExposedExternalTool[]> {
    const key = sessionKey(spec.id, root)
    const existing = this.sessions.get(key)
    if (existing?.state === 'ready') {return existing.tools}
    if (existing?.state === 'connecting' && existing.pending) {
      await existing.pending
      return readyTools(existing)
    }
    if (existing?.state === 'failed' && this.now() - (existing.failedAt ?? 0) < this.retryBackoffMs) {return []}

    const session: Session = {
      spec,
      root,
      fingerprint: fingerprint(spec),
      state: 'connecting',
      tools: [],
      problems: [],
      closed: false,
    }
    this.sessions.set(key, session)
    session.pending = this.connect(session)
    await session.pending
    return readyTools(session)
  }

  private async connect(session: Session): Promise<void> {
    const { spec, root } = session
    try {
      const client = await this.deps.createClient()
      session.client = client
      const transport = await this.deps.createTransport({ command: spec.command, args: spec.args, cwd: root, env: spec.env })
      session.transport = transport
      transport.onclose = () => this.fail(session, 'the server process exited')
      if (session.closed) {return this.teardown(session)}

      await withTimeout(client.connect(transport), this.connectTimeoutMs, `connecting to ${spec.id}`)
      const listed = await withTimeout(client.listTools(), this.connectTimeoutMs, `listing the tools of ${spec.id}`)
      if (session.closed) {return this.teardown(session)}
      if (session.state !== 'connecting') {return} // the process exited while it was listing

      const exposed = exposeTools(spec.id, listed, spec.allowTools)
      session.tools = exposed.tools
      session.problems = exposed.problems
      session.state = 'ready'
      this.deps.log?.('info', `[mcp:${spec.id}] connected in ${root}; offering ${exposed.tools.length} tool(s).`)
      for (const problem of exposed.problems) {this.deps.log?.('warn', `[mcp:${spec.id}] ${problem}`)}
    } catch (err) {
      this.fail(session, describe(err))
    }
  }

  private fail(session: Session, reason: string): void {
    if (session.state === 'failed' || session.closed) {return}
    session.state = 'failed'
    session.failure = reason
    session.failedAt = this.now()
    session.tools = []
    this.deps.log?.('warn', `[mcp:${session.spec.id}] unavailable: ${reason}. Retrying after ${Math.round(this.retryBackoffMs / 1000)} s.`)
    void this.teardown(session)
  }

  private closeSession(key: string): Promise<void> {
    const session = this.sessions.get(key)
    if (!session) {return Promise.resolve()}
    this.sessions.delete(key)
    session.closed = true
    if (session.state !== 'failed') {
      session.state = 'failed'
      session.failure = 'stopped'
    }
    return this.teardown(session)
  }

  private async teardown(session: Session): Promise<void> {
    const client = session.client
    const transport = session.transport
    session.client = undefined
    session.transport = undefined
    session.tools = []
    try {
      if (client) {await client.close()} else if (transport) {await transport.close()}
    } catch (err) {
      this.deps.log?.('debug', `[mcp:${session.spec.id}] close: ${describe(err)}`)
    }
  }
}

/** Reads the state through a function parameter, so a state changed during an await is not narrowed away. */
function readyTools(session: Session): ExposedExternalTool[] {
  return session.state === 'ready' ? session.tools : []
}

function sessionKey(serverId: string, root: string): string {
  return `${serverId}\u0000${root}`
}

function fingerprint(spec: ExternalServerSpec): string {
  return JSON.stringify([spec.command, spec.args, spec.env, spec.allowTools, spec.enabled])
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
