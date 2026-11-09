/**
 * RuntimeEnvironment - the Rails environments runtime introspection may run in, and the environment a Rails child
 * process starts with. Pure and vscode-free.
 *
 * Only development and test are allowed. The environment is always set explicitly and never inherited: a shell that
 * exports RAILS_ENV=production must not turn an introspection run into a production boot.
 */

export const RUNTIME_ENVIRONMENTS = ['development', 'test'] as const

export type RuntimeEnvironment = (typeof RUNTIME_ENVIRONMENTS)[number]

export type EnvironmentCheck =
  | { ok: true; environment: RuntimeEnvironment }
  | { ok: false; code: 'ENVIRONMENT_NOT_ALLOWED'; message: string }

/** Validates a requested Rails environment. An absent request means development. Anything else is refused. */
export function validateRuntimeEnvironment(requested: string | undefined): EnvironmentCheck {
  const value = (requested ?? 'development').trim().toLowerCase()
  if ((RUNTIME_ENVIRONMENTS as readonly string[]).includes(value)) {
    return { ok: true, environment: value as RuntimeEnvironment }
  }
  return {
    ok: false,
    code: 'ENVIRONMENT_NOT_ALLOWED',
    message: `Rails environment "${requested}" is not allowed for runtime introspection. Use development or test.`,
  }
}

/** The environment for a Rails child process. RAILS_ENV and RACK_ENV are set to the validated value, overriding any inherited one. */
export function railsChildEnvironment(base: NodeJS.ProcessEnv, environment: RuntimeEnvironment): NodeJS.ProcessEnv {
  return { ...base, RAILS_ENV: environment, RACK_ENV: environment }
}

/** Whether the environment a snapshot reports is the one that was requested. A mismatch means the snapshot is not cached. */
export function snapshotMatchesEnvironment(reported: string | undefined, requested: RuntimeEnvironment): boolean {
  return reported === requested
}
