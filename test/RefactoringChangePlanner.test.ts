import { describe, it, expect } from 'vitest'
import { validateDiffPlan, PlannedFile } from '../src/refactoring-intelligence/planning/ChangePlanner'
import type { SyntaxVerdict } from '../src/refactoring-intelligence/core/types'

const ORDER = ['class Order < ApplicationRecord', '  def total', '    items.sum(&:price) * 1.2', '  end', '', '  def tax', '    total * 0.2', '  end', 'end', ''].join('\n')

const files: PlannedFile[] = [
  { path: 'app/models/order.rb', before: ORDER },
  { path: 'app/services/tax_calculator.rb', before: undefined },
]

const ok = async (): Promise<SyntaxVerdict> => ({ status: 'ok' })

const GOOD = [
  '--- a/app/models/order.rb',
  '+++ b/app/models/order.rb',
  '@@ -1,5 +1,5 @@',
  ' class Order < ApplicationRecord',
  '   def total',
  '-    items.sum(&:price) * 1.2',
  '+    TaxCalculator.new.gross(items.sum(&:price))',
  '   end',
  ' ',
  '   def tax',
  '--- /dev/null',
  '+++ b/app/services/tax_calculator.rb',
  '@@ -0,0 +1,3 @@',
  '+class TaxCalculator',
  '+  def gross(amount) = amount * 1.2',
  '+end',
].join('\n')

describe('validateDiffPlan: accepts a safe plan', () => {
  it('returns the exact before and after text for each change', async () => {
    const result = await validateDiffPlan(GOOD, files, ok)
    expect(result.ok).toBe(true)
    if (!result.ok) {return}
    expect(result.value.syntaxUnverified).toBe(false)
    expect(result.value.changes.map(c => [c.path, c.kind])).toEqual([['app/models/order.rb', 'modify'], ['app/services/tax_calculator.rb', 'create']])
    expect(result.value.changes[0].after).toContain('TaxCalculator.new.gross(items.sum(&:price))')
    expect(result.value.changes[1].after).toBe('class TaxCalculator\n  def gross(amount) = amount * 1.2\nend\n')
  })

  it('accepts a fenced diff with prose around it', async () => {
    const answer = `Here is the change:\n\`\`\`diff\n${GOOD}\n\`\`\`\nThanks!`
    expect((await validateDiffPlan(answer, files, ok)).ok).toBe(true)
  })

  it('flags syntaxUnverified when no Ruby interpreter is available', async () => {
    const result = await validateDiffPlan(GOOD, files, async () => ({ status: 'unavailable' }))
    expect(result.ok && result.value.syntaxUnverified).toBe(true)
  })
})

describe('validateDiffPlan: rejects unsafe or unusable answers', () => {
  it('rejects an answer with no diff', async () => {
    expect(await validateDiffPlan('Sorry, I cannot.', files, ok)).toMatchObject({ ok: false, reason: 'invalid-response' })
  })

  it('rejects a hunk with no +++ header', async () => {
    const headless = ['@@ -1,1 +1,1 @@', '-class Order < ApplicationRecord', '+class Order'].join('\n')
    expect(await validateDiffPlan(headless, files, ok)).toMatchObject({ ok: false, reason: 'invalid-response' })
  })

  it('rejects a path outside the recommendation (file-not-allowed)', async () => {
    const outOfScope = GOOD.replace(/app\/models\/order\.rb/g, 'app/models/user.rb')
    expect(await validateDiffPlan(outOfScope, files, ok)).toMatchObject({ ok: false, reason: 'file-not-allowed' })
  })

  it('rejects a traversal path in a header', async () => {
    expect(await validateDiffPlan(GOOD.replace('+++ b/app/services/tax_calculator.rb', '+++ b/../../etc/cron.rb'), files, ok))
      .toMatchObject({ ok: false, reason: 'unsafe-path' })
  })

  it('rejects a deletion: the advisor never removes files', async () => {
    const deletion = ['--- a/app/models/order.rb', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-class Order < ApplicationRecord'].join('\n')
    expect(await validateDiffPlan(deletion, files, ok)).toMatchObject({ ok: false, reason: 'unsafe-path' })
  })

  it('rejects context lines that do not match the current file', async () => {
    const stale = GOOD.replace(' class Order < ApplicationRecord', ' class Orderz < ApplicationRecord')
    expect(await validateDiffPlan(stale, files, ok)).toMatchObject({ ok: false, reason: 'hunk-mismatch' })
  })

  it('rejects an edit (old lines) aimed at a file that does not exist yet', async () => {
    const edit = ['--- a/app/services/tax_calculator.rb', '+++ b/app/services/tax_calculator.rb', '@@ -1,2 +1,2 @@', ' class TaxCalculator', '-  def a; end', '+  def a = 1'].join('\n')
    expect(await validateDiffPlan(edit, files, ok)).toMatchObject({ ok: false, reason: 'file-missing' })
  })

  it('rejects a /dev/null create aimed at a file that already exists', async () => {
    const existing: PlannedFile[] = [{ path: 'app/services/tax_calculator.rb', before: 'class TaxCalculator; end\n' }]
    const create = ['--- /dev/null', '+++ b/app/services/tax_calculator.rb', '@@ -0,0 +1,1 @@', '+class TaxCalculator; end'].join('\n')
    expect(await validateDiffPlan(create, existing, ok)).toMatchObject({ ok: false, reason: 'file-exists' })
  })

  it('rejects a diff that changes nothing', async () => {
    const noop = ['--- a/app/models/order.rb', '+++ b/app/models/order.rb', '@@ -1,3 +1,3 @@', ' class Order < ApplicationRecord', '   def total', '-    items.sum(&:price) * 1.2', '+    items.sum(&:price) * 1.2'].join('\n')
    expect(await validateDiffPlan(noop, [files[0]], ok)).toMatchObject({ ok: false, reason: 'no-change' })
  })

  it('rejects a new file that would be empty', async () => {
    const empty = ['--- /dev/null', '+++ b/app/services/tax_calculator.rb', '@@ -0,0 +1,1 @@', '+   '].join('\n')
    expect(await validateDiffPlan(empty, [files[1]], ok)).toMatchObject({ ok: false, reason: 'invalid-response' })
  })

  it('rejects a change that would not parse as Ruby, and names the file', async () => {
    const broken = GOOD.replace('+    TaxCalculator.new.gross(items.sum(&:price))', '+    BROKEN(items.sum(&:price)')
    const result = await validateDiffPlan(broken, files, async code => (code.includes('BROKEN') ? { status: 'error', message: 'syntax error, unexpected end-of-input' } : { status: 'ok' }))
    expect(result).toMatchObject({ ok: false, reason: 'syntax-error' })
    expect(result.ok ? '' : result.message).toContain('app/models/order.rb would not parse as Ruby: syntax error, unexpected end-of-input')
  })
})
