import { describe, expect, it } from 'vitest'
import { railsChildEnvironment, snapshotMatchesEnvironment, validateRuntimeEnvironment } from '../src/rails/RuntimeEnvironment'

describe('validateRuntimeEnvironment', () => {
  it('defaults to development when no environment is requested', () => {
    expect(validateRuntimeEnvironment(undefined)).toEqual({ ok: true, environment: 'development' })
  })

  it('accepts development and test, ignoring case and surrounding spaces', () => {
    expect(validateRuntimeEnvironment('test')).toEqual({ ok: true, environment: 'test' })
    expect(validateRuntimeEnvironment(' Development ')).toEqual({ ok: true, environment: 'development' })
  })

  it('refuses production, staging, empty and unknown environments', () => {
    for (const value of ['production', 'staging', '', 'sandbox', 'development; rm -rf /']) {
      expect(validateRuntimeEnvironment(value)).toMatchObject({ ok: false, code: 'ENVIRONMENT_NOT_ALLOWED' })
    }
  })
})

describe('railsChildEnvironment', () => {
  it('overrides an inherited production environment with the validated one', () => {
    const env = railsChildEnvironment({ RAILS_ENV: 'production', RACK_ENV: 'production', HOME: '/home/dev' }, 'development')
    expect(env).toMatchObject({ RAILS_ENV: 'development', RACK_ENV: 'development', HOME: '/home/dev' })
  })

  it('does not modify the base environment it was given', () => {
    const base: NodeJS.ProcessEnv = { RAILS_ENV: 'production' }
    railsChildEnvironment(base, 'test')
    expect(base.RAILS_ENV).toBe('production')
  })
})

describe('snapshotMatchesEnvironment', () => {
  it('accepts only the environment that was requested', () => {
    expect(snapshotMatchesEnvironment('development', 'development')).toBe(true)
    expect(snapshotMatchesEnvironment('production', 'development')).toBe(false)
    expect(snapshotMatchesEnvironment(undefined, 'test')).toBe(false)
  })
})
