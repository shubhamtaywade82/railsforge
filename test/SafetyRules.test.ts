import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { SAFETY_RULES, evaluateSafety } from '../src/skills/SafetyRules'
import { parseCatalog } from '../src/skills/SkillCatalog'
import { routeSkills } from '../src/skills/SkillRouter'
import { buildSkillContext } from '../src/skills/SkillContextBuilder'
import { SkillRegistry } from '../src/skills/SkillRegistry'

const catalog = parseCatalog(JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'skills', 'catalog.json'), 'utf8')))!
const rules = (prompt: string, context?: string): string[] => evaluateSafety({ prompt, context }).map(f => f.rule)

describe('every rule exists in the catalog and is covered', () => {
  it('forces only skills the pack actually ships', () => {
    for (const rule of SAFETY_RULES) {
      for (const id of rule.skills) {expect(catalog.skills[id], `${rule.id} -> ${id}`).toBeDefined()}
    }
  })
})

describe('evaluateSafety — triggers', () => {
  it.each([
    ['Run rails db:reset and reseed everything', 'destructive-database'],
    ['DROP TABLE users;', 'destructive-database'],
    ['clean up with Order.delete_all', 'destructive-database'],
    ['User.where("name = \'#{params[:q]}\'")', 'sql-injection'],
    ['is this vulnerable to SQL injection?', 'sql-injection'],
    ['find_by_sql("select * from users where id = " + params[:id])', 'sql-injection'],
    ['User.update(params)', 'mass-assignment'],
    ['params.require(:user).permit!', 'mass-assignment'],
    ['klass = params[:type].constantize.new', 'dynamic-dispatch-on-input'],
    ['system("convert #{params[:file]}")', 'dynamic-dispatch-on-input'],
    ['my AWS key sk-abcdefghijklmnop12345678 is hardcoded in the repo', 'committed-secret'],
    ['log the password on failed login', 'committed-secret'],
    ['rename_column :users, :name, :full_name', 'live-table-schema-change'],
    ['add an index on orders.user_id', 'live-table-schema-change'],
    ['remove the status column from orders', 'live-table-schema-change'],
    ['rm -rf node_modules and tmp', 'destructive-shell-vcs'],
    ['git push --force origin main', 'destructive-shell-vcs'],
    ['git reset --hard HEAD~3', 'destructive-shell-vcs'],
    ['sudo gem install bundler', 'destructive-shell-vcs'],
    ['drop the orders table in production', 'production-operation'],
    ['run the migration in production tonight', 'production-operation'],
    ['skip_before_action :authenticate_user!', 'disabled-protection'],
    ['disable csrf for the webhook controller', 'disabled-protection'],
  ])('%s -> %s', (prompt, rule) => {
    expect(rules(prompt)).toContain(rule)
  })

  it('reads the context as well as the prompt (e.g. a diagnostic message)', () => {
    expect(rules('fix this', 'ActiveRecord::StatementInvalid near "#{params[:q]}"')).not.toContain('sql-injection') // no SQL call shape, no false alarm
    expect(rules('fix this', 'where("id = #{params[:id]}")')).toContain('sql-injection')
  })
})

describe('evaluateSafety — benign requests stay quiet', () => {
  it.each([
    'Add a validation for the email format',
    'Write a service object for checkout',
    'Add an index concurrently on orders.user_id',
    'where(name: params[:q])',
    'User.update(user_params)',
    'Explain how migrations work',
    'Rename the Order model to Purchase in the views',
    'Use git to review the diff',
    'Show the production readiness checklist',
    'delete the draft comment from the form',
  ])('%s', prompt => {
    expect(rules(prompt)).toEqual([])
  })

  it('is deterministic and linear-time on pathological input', () => {
    const nasty = `where("${'a'.repeat(50_000)}`
    const started = Date.now()
    const first = evaluateSafety({ prompt: nasty })
    expect(Date.now() - started).toBeLessThan(500)
    expect(evaluateSafety({ prompt: nasty })).toEqual(first)
    // Many keyword starts on one very long line must not make evaluation quadratic.
    const manyStarts = `where("`.repeat(8000) + 'a'.repeat(20_000)
    const t1 = Date.now()
    evaluateSafety({ prompt: manyStarts })
    expect(Date.now() - t1).toBeLessThan(1000)
    const dots = 'x'.repeat(20_000) + ' ' + 'production '.repeat(2000)
    const t2 = Date.now()
    evaluateSafety({ prompt: dots })
    expect(Date.now() - t2).toBeLessThan(500)
  })
})

describe('integration with the router and the prompt block', () => {
  it('forces the security skills for a SQL-injection-shaped request even when scoring would not pick them', () => {
    const routed = routeSkills(catalog, { prompt: 'make this faster: User.where("name = \'#{q}\'")' })
    const forced = routed.filter(r => r.role === 'safety').map(r => r.id)
    expect(forced.length + routed.filter(r => r.reasons.some(x => x.startsWith('safety:'))).length).toBeGreaterThan(0)
    expect(routed.map(r => r.id)).toContain('rails-security')
  })

  it('does not count forced skills against maxSkills and can be switched off', () => {
    const prompt = 'rename_column :users, :name, :full_name and add an index on email'
    const on = routeSkills(catalog, { prompt }, { maxSkills: 1 })
    expect(on.some(r => r.reasons.includes('safety: live-table-schema-change'))).toBe(true)
    const off = routeSkills(catalog, { prompt }, { maxSkills: 1, safety: false })
    expect(off.some(r => r.reasons.some(x => x.startsWith('safety:')))).toBe(false)
  })

  it('adds a "Safety notes" block to the prompt context, even when no skill matched', () => {
    const registry = new SkillRegistry({})
    const text = buildSkillContext(registry, [], { prompt: 'git push --force origin main' })
    expect(text).toContain('### Safety notes for this request')
    expect(text).toContain('destructive-shell-vcs')
    expect(buildSkillContext(registry, [], { prompt: 'explain associations' })).toBe('')
  })
})
