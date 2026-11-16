/**
 * SdkExternalClient - the real `@modelcontextprotocol/sdk` client behind ExternalServerManager.
 *
 * The SDK is loaded on first use, not at activation: a window that never starts an external server pays nothing for
 * it. The process is started with the project root as its working directory, and with the default environment
 * (PATH, HOME and similar) plus only the variables the user configured. The extension host's full environment is not
 * passed on. Server stderr goes to the debug log, one clipped line at a time.
 *
 * The SDK surface is described here by the few members this code calls, rather than by the SDK's own declarations.
 * The package ships separate CJS and ESM declarations, and this keeps the adapter independent of them.
 *
 * vscode-free.
 */

import { ExternalCallError } from './ExternalServerManager'
import type { ExternalClient, ExternalServerManagerDeps, ExternalTransport, TransportLaunch } from './ExternalServerManager'
import type { RemoteToolDescriptor } from './ExternalTools'

/** Reported to servers as the client name. It identifies the client only; it is not the extension version. */
const CLIENT_INFO = { name: 'railsforge', version: '1.0.0' }
const STDERR_LINE_LIMIT = 400

export interface SdkFactoryOptions {
  /** Receives each line of a server's stderr. Lines are clipped; secrets in server output are the server's to avoid. */
  onStderr?(line: string): void
}

interface SdkClientLike {
  connect(transport: unknown): Promise<void>
  listTools(): Promise<{ tools: unknown[] }>
  callTool(params: { name: string; arguments: Record<string, unknown> }, resultSchema: undefined, options: { timeout: number; signal?: AbortSignal }): Promise<unknown>
  close(): Promise<void>
}

interface SdkStdioTransportLike extends ExternalTransport {
  readonly stderr: NodeJS.ReadableStream | null
}

interface SdkModules {
  newClient(): SdkClientLike
  newTransport(params: { command: string; args: string[]; cwd: string; env: Record<string, string>; stderr: 'pipe' }): SdkStdioTransportLike
  defaultEnvironment(): Record<string, string>
}

export function sdkExternalClientFactory(options: SdkFactoryOptions = {}): Pick<ExternalServerManagerDeps, 'createClient' | 'createTransport'> {
  let sdk: Promise<SdkModules> | undefined
  const load = (): Promise<SdkModules> => {
    if (!sdk) {
      sdk = Promise.all([
        import('@modelcontextprotocol/sdk/client/index.js'),
        import('@modelcontextprotocol/sdk/client/stdio.js'),
      ]).then(([clientModule, stdioModule]) => {
        const client = clientModule as unknown as { Client: new (info: typeof CLIENT_INFO, options: { capabilities: object }) => SdkClientLike }
        const stdio = stdioModule as unknown as {
          StdioClientTransport: new (params: Parameters<SdkModules['newTransport']>[0]) => SdkStdioTransportLike
          getDefaultEnvironment: () => Record<string, string>
        }
        return {
          newClient: () => new client.Client(CLIENT_INFO, { capabilities: {} }),
          newTransport: params => new stdio.StdioClientTransport(params),
          defaultEnvironment: () => stdio.getDefaultEnvironment(),
        }
      })
    }
    return sdk
  }

  return {
    createClient: async (): Promise<ExternalClient> => new SdkClientAdapter((await load()).newClient()),
    createTransport: async (launch: TransportLaunch): Promise<ExternalTransport> => {
      const modules = await load()
      const transport = modules.newTransport({
        command: launch.command,
        args: [...launch.args],
        cwd: launch.cwd,
        env: { ...modules.defaultEnvironment(), ...launch.env },
        stderr: 'pipe',
      })
      const stderr = transport.stderr
      if (stderr && options.onStderr) {
        const emit = options.onStderr
        stderr.on('data', (chunk: Buffer | string) => {
          for (const line of String(chunk).split('\n')) {
            const trimmed = line.trim()
            if (trimmed) {emit(trimmed.slice(0, STDERR_LINE_LIMIT))}
          }
        })
      }
      return transport
    },
  }
}

class SdkClientAdapter implements ExternalClient {
  constructor(private readonly client: SdkClientLike) {}

  connect(transport: ExternalTransport): Promise<void> {
    return this.client.connect(transport)
  }

  async listTools(): Promise<RemoteToolDescriptor[]> {
    const listed = await this.client.listTools()
    return listed.tools as RemoteToolDescriptor[]
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<{ text: string; isError: boolean }> {
    try {
      // The SDK sends an MCP cancellation to the server when the signal aborts, and rejects the request locally.
      const result = await this.client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs, signal }) as { content?: unknown; isError?: unknown }
      return { text: textOf(result.content), isError: result.isError === true }
    } catch (err) {
      throw classifyCallError(err, signal)
    }
  }

  close(): Promise<void> {
    return this.client.close()
  }
}

/** Turns an SDK failure into the manager's codes. A cancelled signal wins over whatever the SDK reported. */
export function classifyCallError(err: unknown, signal?: AbortSignal): ExternalCallError {
  const message = err instanceof Error ? err.message : String(err)
  if (signal?.aborted) {return new ExternalCallError('CANCELLED', 'The call was cancelled.')}
  const code = (err as { code?: unknown } | null)?.code
  if (code === -32001 || /timed out|timeout/i.test(message)) {return new ExternalCallError('TIMEOUT', message)}
  if (/closed|exited|not connected|transport/i.test(message)) {return new ExternalCallError('SERVER_EXITED', message)}
  return new ExternalCallError('SERVER_ERROR', message)
}

/** Joins the text blocks of a tool result. Other content (images, resources) is named, not passed through. */
export function textOf(content: unknown): string {
  if (!Array.isArray(content)) {return ''}
  return content
    .map(block => {
      const typed = block as { type?: unknown; text?: unknown }
      if (typed.type === 'text' && typeof typed.text === 'string') {return typed.text}
      return `[${typeof typed.type === 'string' ? typed.type : 'unknown'} content omitted]`
    })
    .join('\n')
}
