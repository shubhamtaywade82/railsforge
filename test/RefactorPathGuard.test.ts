import { describe, it, expect } from 'vitest'
import { checkAdvisorPath, specCandidates } from '../src/refactor/advisor/PathGuard'

describe('checkAdvisorPath', () => {
  it.each([
    'app/models/order.rb',
    'app/services/payments/charge_service.rb',
    'lib/tax/calculator.rb',
    'spec/models/order_spec.rb',
    'test/models/order_test.rb',
  ])('accepts %s', path => {
    expect(checkAdvisorPath(path)).toEqual({ ok: true, path })
  })

  it('normalises backslashes and a leading ./', () => {
    expect(checkAdvisorPath('.\\app\\models\\order.rb')).toEqual({ ok: true, path: 'app/models/order.rb' })
    expect(checkAdvisorPath('./app/models/order.rb')).toEqual({ ok: true, path: 'app/models/order.rb' })
  })

  it.each([
    ['parent traversal', 'app/../../etc/passwd.rb'],
    ['traversal through a Windows separator', 'app\\..\\..\\secrets.rb'],
    ['absolute POSIX path', '/etc/passwd.rb'],
    ['absolute Windows path', 'C:/Users/me/x.rb'],
    ['empty segment', 'app//models/order.rb'],
    ['current-directory segment', 'app/./models/order.rb'],
    ['empty path', '   '],
    ['control character', 'app/models/order\u0007.rb'],
    ['newline injection', 'app/models/order.rb\nconfig/database.yml'],
  ])('rejects %s', (_label, path) => {
    expect(checkAdvisorPath(path).ok).toBe(false)
  })

  it.each([
    'config/routes.rb',
    'db/migrate/20260101_add_x.rb',
    'Gemfile',
    'vendor/bundle/gem.rb',
    '.github/workflows/ci.yml',
    'node_modules/x/index.rb',
  ])('rejects %s because it is outside the Rails source roots', path => {
    const result = checkAdvisorPath(path)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toContain('only app/, lib/, spec/ and test/')
  })

  it('rejects non-Ruby files inside an allowed root', () => {
    const result = checkAdvisorPath('app/views/orders/index.html.erb')
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).toContain('Ruby (.rb)')
  })

  it('rejects an overlong path', () => {
    expect(checkAdvisorPath(`app/${'a'.repeat(250)}.rb`).ok).toBe(false)
  })
})

describe('specCandidates', () => {
  it('maps app and lib files to their conventional spec and test locations', () => {
    expect(specCandidates('app/models/order.rb')).toEqual(['spec/models/order_spec.rb', 'test/models/order_test.rb'])
    expect(specCandidates('lib/tax/calculator.rb')).toEqual(['spec/tax/calculator_spec.rb', 'test/tax/calculator_test.rb'])
  })

  it('returns nothing for files that have no conventional spec location', () => {
    expect(specCandidates('spec/models/order_spec.rb')).toEqual([])
    expect(specCandidates('config/routes.rb')).toEqual([])
  })
})
