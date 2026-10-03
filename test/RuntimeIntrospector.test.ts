import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { BEGIN_MARKER, END_MARKER, INTROSPECTION_SCRIPT, formatSnapshotMarkdown, parseIntrospectionOutput } from '../src/rails/RuntimeIntrospector'

const SAMPLE = {
  rails: '7.1.3', ruby: '3.3.0', environment: 'development',
  models: [
    {
      name: 'User', table: 'users', file: '/app/models/user.rb',
      associations: [{ name: 'orders', macro: 'has_many', class_name: 'Order', options: { dependent: 'destroy' } }],
      validations: [{ kind: 'presence', attributes: ['email'], options: {} }],
      callbacks: [{ event: 'save', kind: 'before', filter: 'normalize' }],
    },
    { name: 'Broken', error: 'NameError: boom' },
  ],
  routes: [{ verb: 'GET', path: '/users(.:format)', controller: 'users', action: 'index', name: 'users' }],
  middleware: ['ActionDispatch::Static'],
}

describe('parseIntrospectionOutput', () => {
  it('extracts the JSON between the markers, ignoring boot noise', () => {
    const out = `DEPRECATION WARNING: x\n${BEGIN_MARKER}\n${JSON.stringify(SAMPLE)}\n${END_MARKER}\nbye`
    const snap = parseIntrospectionOutput(out)!
    expect(snap.rails).toBe('7.1.3')
    expect(snap.models.map(m => m.name)).toEqual(['User', 'Broken'])
    expect(snap.models[0].associations[0]).toMatchObject({ macro: 'has_many', class_name: 'Order' })
    expect(snap.models[1].error).toBe('NameError: boom')
    expect(snap.routes[0]).toMatchObject({ verb: 'GET', controller: 'users' })
  })

  it('returns undefined without markers or with malformed JSON', () => {
    expect(parseIntrospectionOutput('no markers')).toBeUndefined()
    expect(parseIntrospectionOutput(`${BEGIN_MARKER}\n{oops\n${END_MARKER}`)).toBeUndefined()
    expect(parseIntrospectionOutput(`${BEGIN_MARKER}\n{"foo":1}\n${END_MARKER}`)).toBeUndefined()
  })

  it('coerces unexpected shapes instead of throwing', () => {
    const weird = { rails: 5, models: [{ name: 'X', associations: 'nope', validations: [{ kind: 1, attributes: [2] }] }, { name: 3 }] }
    const snap = parseIntrospectionOutput(`${BEGIN_MARKER}${JSON.stringify(weird)}${END_MARKER}`)!
    expect(snap.rails).toBe('')
    expect(snap.models).toHaveLength(1)
    expect(snap.models[0].associations).toEqual([])
  })
})

describe('formatSnapshotMarkdown', () => {
  it('renders models, routes and middleware', () => {
    const md = formatSnapshotMarkdown(parseIntrospectionOutput(`${BEGIN_MARKER}${JSON.stringify(SAMPLE)}${END_MARKER}`)!)
    expect(md).toContain('### User → `users`')
    expect(md).toContain('has_many `orders` → Order (dependent: destroy)')
    expect(md).toContain('validates email: presence')
    expect(md).toContain('before_save: normalize')
    expect(md).toContain('_introspection error: NameError: boom_')
    expect(md).toContain('GET /users(.:format) → users#index (users)')
  })
})

describe('INTROSPECTION_SCRIPT', () => {
  const ruby = spawnSync('ruby', ['-v'])
  it.skipIf(ruby.status !== 0)('is valid Ruby and prints both markers', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-introspect-')), 'introspect.rb')
    fs.writeFileSync(file, INTROSPECTION_SCRIPT)
    const check = spawnSync('ruby', ['-c', file], { encoding: 'utf8' })
    expect(check.status, check.stderr).toBe(0)
    expect(INTROSPECTION_SCRIPT).toContain(BEGIN_MARKER)
    expect(INTROSPECTION_SCRIPT).toContain(END_MARKER)
  })
})
