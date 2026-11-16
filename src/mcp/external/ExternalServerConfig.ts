/**
 * ExternalServerConfig - validates `railsForge.mcp.servers`, the user's list of external stdio MCP servers.
 *
 * Trust boundary: every entry starts a process on this machine. The setting therefore has `application` scope
 * (package.json), so only user settings can define one, and the reader in extension.ts looks at the user value only.
 * A repository's `.vscode/settings.json` cannot start a process through this setting.
 *
 * Fails closed: an entry with any problem is dropped and reported, never applied in part. An unknown key is a
 * problem, because a typo in `allowTools` would otherwise silently expose nothing.
 *
 * vscode-free.
 */

export const EXTERNAL_SERVER_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const MAX_ARGS = 64
const MAX_ARG_LENGTH = 4096
const MAX_ENV_VALUE_LENGTH = 4096
const MAX_ALLOW_TOOLS = 100
const MAX_TOOL_NAME_LENGTH = 128
const MAX_COMMAND_LENGTH = 1024

export const EXTERNAL_SERVER_KEYS: readonly string[] = ['id', 'enabled', 'transport', 'command', 'args', 'env', 'allowTools', 'toolRisk', 'exposeToEditor']

/** The risk a user may declare for an allowed tool. An unlisted tool is R3: it asks for approval on every call. */
export type DeclaredToolRisk = 'R2' | 'R3'

export interface ExternalServerSpec {
  id: string
  enabled: boolean
  transport: 'stdio'
  command: string
  args: readonly string[]
  env: Readonly<Record<string, string>>
  /** Remote tool names to expose to RailsForge's own agent. Nothing is exposed unless it is listed here (default deny). */
  allowTools: readonly string[]
  /**
   * The risk of each allowed tool. R2: runs without a prompt, in a trusted workspace. R3: asks for approval on every
   * call. A tool not listed here is R3. R4 is never accepted.
   */
  toolRisk: Readonly<Record<string, DeclaredToolRisk>>
  /**
   * Also offer this server to the editor's own agent (Copilot, Cursor). The editor does not apply `allowTools`, so
   * every tool the server provides reaches that agent. Off by default, and only ever set by the user.
   */
  exposeToEditor: boolean
}

export interface ExternalServerProblem {
  /** Position in the setting array, or -1 when the setting itself is not an array. */
  index: number
  id?: string
  message: string
}

export interface ExternalServerParse {
  servers: ExternalServerSpec[]
  problems: ExternalServerProblem[]
}

type EntryResult = { ok: true; spec: ExternalServerSpec } | { ok: false; id?: string; message: string }

/** Parses the raw setting value. Never throws: any shape it does not understand is reported as a problem. */
export function parseExternalServers(raw: unknown): ExternalServerParse {
  if (raw === undefined || raw === null) {return { servers: [], problems: [] }}
  if (!Array.isArray(raw)) {
    return { servers: [], problems: [{ index: -1, message: 'railsForge.mcp.servers must be an array of server objects.' }] }
  }
  const servers: ExternalServerSpec[] = []
  const problems: ExternalServerProblem[] = []
  const seen = new Set<string>()
  raw.forEach((entry, index) => {
    const result = parseEntry(entry)
    if (!result.ok) {
      problems.push({ index, id: result.id, message: result.message })
      return
    }
    if (seen.has(result.spec.id)) {
      problems.push({ index, id: result.spec.id, message: `Duplicate server id "${result.spec.id}"; this entry is ignored.` })
      return
    }
    seen.add(result.spec.id)
    servers.push(result.spec)
  })
  return { servers, problems }
}

function parseEntry(entry: unknown): EntryResult {
  if (!isPlainObject(entry)) {return { ok: false, message: 'Each entry must be an object.' }}
  const id = typeof entry.id === 'string' ? entry.id : undefined
  const fail = (message: string): EntryResult => ({ ok: false, id, message })

  // Checked before unknown keys: an HTTP entry carries `url`, and the reason it is refused is the useful message.
  if (entry.transport === 'http') {return fail('HTTP servers are not supported yet. Only "stdio" is.')}

  const unknown = Object.keys(entry).filter(key => !EXTERNAL_SERVER_KEYS.includes(key))
  if (unknown.length > 0) {return fail(`Unknown setting "${unknown[0]}". Allowed: ${EXTERNAL_SERVER_KEYS.join(', ')}.`)}

  if (typeof entry.id !== 'string' || !EXTERNAL_SERVER_ID_PATTERN.test(entry.id)) {
    return fail('id must be 1 to 32 lowercase letters, digits or hyphens, starting with a letter.')
  }

  const enabled = entry.enabled === undefined ? true : entry.enabled
  if (typeof enabled !== 'boolean') {return fail('enabled must be true or false.')}

  if (entry.transport !== undefined && entry.transport !== 'stdio') {return fail('transport must be "stdio".')}

  if (!isSafeString(entry.command, MAX_COMMAND_LENGTH) || entry.command.trim() !== entry.command) {
    return fail('command must be the executable to start, with no leading or trailing spaces and no line breaks.')
  }

  const args = entry.args === undefined ? [] : entry.args
  if (!Array.isArray(args) || args.length > MAX_ARGS || !args.every(arg => isSafeString(arg, MAX_ARG_LENGTH))) {
    return fail(`args must be an array of up to ${MAX_ARGS} strings.`)
  }

  const env = entry.env === undefined ? {} : entry.env
  if (!isPlainObject(env)) {return fail('env must be an object of string values.')}
  for (const [key, value] of Object.entries(env)) {
    if (!ENV_KEY_PATTERN.test(key)) {return fail(`env name "${key}" is not a valid variable name.`)}
    if (!isSafeString(value, MAX_ENV_VALUE_LENGTH)) {return fail(`env value for "${key}" must be a string.`)}
  }

  const exposeToEditor = entry.exposeToEditor === undefined ? false : entry.exposeToEditor
  if (typeof exposeToEditor !== 'boolean') {return fail('exposeToEditor must be true or false.')}

  const allowTools = entry.allowTools === undefined ? [] : entry.allowTools
  if (!Array.isArray(allowTools) || allowTools.length > MAX_ALLOW_TOOLS || !allowTools.every(name => isSafeString(name, MAX_TOOL_NAME_LENGTH))) {
    return fail(`allowTools must be an array of up to ${MAX_ALLOW_TOOLS} tool names.`)
  }

  const toolRisk = entry.toolRisk === undefined ? {} : entry.toolRisk
  if (!isPlainObject(toolRisk)) {return fail('toolRisk must be an object that maps an allowed tool name to "R2" or "R3".')}
  for (const [name, risk] of Object.entries(toolRisk)) {
    if (risk === 'R4') {return fail(`toolRisk for "${name}" is R4. R4 operations are never offered to the agent.`)}
    if (risk !== 'R2' && risk !== 'R3') {return fail(`toolRisk for "${name}" must be "R2" or "R3".`)}
    if (!(allowTools as string[]).includes(name)) {return fail(`toolRisk names "${name}", which is not in allowTools.`)}
  }

  return {
    ok: true,
    spec: {
      id: entry.id,
      enabled,
      transport: 'stdio',
      command: entry.command,
      args: [...args] as string[],
      env: { ...(env as Record<string, string>) },
      allowTools: [...new Set(allowTools as string[])],
      toolRisk: { ...(toolRisk as Record<string, DeclaredToolRisk>) },
      exposeToEditor,
    },
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A non-empty string without NUL bytes or line breaks, within a length limit. */
function isSafeString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\0\r\n]/.test(value)
}
