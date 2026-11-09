import { describe, it, expect } from 'vitest'
import { openIndexDatabase } from '../src/indexer/database'
import { indexFileIntoDb } from '../src/indexer/PersistentIndexer'
import { RubyAstParser } from '../src/indexer/RubyAstParser'
import { DuplicateMethodDetector } from '../src/indexer/DuplicateMethodDetector'
import { isPersistentIndexSupported } from '../src/indexer/nativeSupport'

const parser = new RubyAstParser()

const sendWelcomeEmail = `
class SendWelcomeEmailService < ApplicationService
  def call
    return unless @user.email.present?
    return if @user.suppressed?

    UserMailer.welcome(@user).deliver_later
    @user.update!(welcomed_at: Time.current)
  end
end
`

// Same logic, different names/receiver var — should still be flagged as a near-duplicate.
const sendReminderEmail = `
class SendReminderEmailService < ApplicationService
  def call
    return unless @account.email.present?
    return if @account.suppressed?

    UserMailer.welcome(@account).deliver_later
    @account.update!(welcomed_at: Time.current)
  end
end
`

const chargeCard = `
class ChargeCardService < ApplicationService
  def call
    PaymentGateway.charge(@user, @amount)
  end
end
`

// See src/indexer/database.ts: better-sqlite3 requires Node >= 22.14, and loading it
// on an older runtime aborts the process rather than throwing a catchable error.
function sqliteBindingsLoadable(): boolean {
  if (!isPersistentIndexSupported()) {return false}
  try {
    openIndexDatabase(':memory:').close()
    return true
  } catch {
    return false
  }
}

describe.skipIf(!sqliteBindingsLoadable())('DuplicateMethodDetector', () => {
  it('flags two methods with highly similar token content as duplicates', () => {
    const db = openIndexDatabase(':memory:')
    indexFileIntoDb(db, '/repo/app/services/send_welcome_email_service.rb', sendWelcomeEmail, parser)
    indexFileIntoDb(db, '/repo/app/services/send_reminder_email_service.rb', sendReminderEmail, parser)

    const detector = new DuplicateMethodDetector(db)
    const duplicates = detector.findDuplicates()

    expect(duplicates.length).toBeGreaterThan(0)
    expect(duplicates[0].similarity).toBeGreaterThanOrEqual(0.75)
  })

  it('does not flag unrelated methods', () => {
    const db = openIndexDatabase(':memory:')
    indexFileIntoDb(db, '/repo/app/services/send_welcome_email_service.rb', sendWelcomeEmail, parser)
    indexFileIntoDb(db, '/repo/app/services/charge_card_service.rb', chargeCard, parser)

    const detector = new DuplicateMethodDetector(db)
    expect(detector.findDuplicates()).toEqual([])
  })

  it('ignores trivial short methods below the minLines threshold', () => {
    const db = openIndexDatabase(':memory:')
    indexFileIntoDb(db, '/repo/app/services/a.rb', 'class A\n  def call\n    true\n  end\nend\n', parser)
    indexFileIntoDb(db, '/repo/app/services/b.rb', 'class B\n  def call\n    true\n  end\nend\n', parser)

    const detector = new DuplicateMethodDetector(db)
    expect(detector.findDuplicates()).toEqual([])
  })

  it('filters duplicates to those involving a specific file', () => {
    const db = openIndexDatabase(':memory:')
    indexFileIntoDb(db, '/repo/app/services/send_welcome_email_service.rb', sendWelcomeEmail, parser)
    indexFileIntoDb(db, '/repo/app/services/send_reminder_email_service.rb', sendReminderEmail, parser)
    indexFileIntoDb(db, '/repo/app/services/charge_card_service.rb', chargeCard, parser)

    const detector = new DuplicateMethodDetector(db)
    const forCharge = detector.findDuplicatesForFile('/repo/app/services/charge_card_service.rb')
    expect(forCharge).toEqual([])

    const forWelcome = detector.findDuplicatesForFile('/repo/app/services/send_welcome_email_service.rb')
    expect(forWelcome.length).toBeGreaterThan(0)
  })

  it('reports the end line of both sides of each pair', () => {
    const db = openIndexDatabase(':memory:')
    indexFileIntoDb(db, '/repo/app/services/send_welcome_email_service.rb', sendWelcomeEmail, parser)
    indexFileIntoDb(db, '/repo/app/services/send_reminder_email_service.rb', sendReminderEmail, parser)

    const [pair] = new DuplicateMethodDetector(db).findDuplicates()
    expect(pair.a.endLine).toBeGreaterThanOrEqual(pair.a.startLine)
    expect(pair.b.endLine).toBeGreaterThanOrEqual(pair.b.startLine)
  })

  it('finds exactly the pairs an exhaustive comparison finds', () => {
    // The size-ratio prefilter must never drop a pair that reaches the threshold. An exhaustive
    // comparison over the same rows is the reference.
    const invoiceService = `
class InvoiceService
  def call
    invoice = Invoice.new(invoice_params)
    invoice.save!
    Mailer.send_invoice(invoice).deliver_later
    invoice
  end
end
`
    const db = openIndexDatabase(':memory:')
    indexFileIntoDb(db, '/repo/app/services/send_welcome_email_service.rb', sendWelcomeEmail, parser)
    indexFileIntoDb(db, '/repo/app/services/send_reminder_email_service.rb', sendReminderEmail, parser)
    indexFileIntoDb(db, '/repo/app/services/charge_card_service.rb', chargeCard, parser)
    indexFileIntoDb(db, '/repo/app/services/invoice_service.rb', invoiceService, parser)

    const rows = db
      .prepare('SELECT name, file_path, start_line, end_line, normalized_body, body_tokens FROM methods')
      .all() as Array<{ file_path: string; start_line: number; normalized_body: string; body_tokens: string }>
    const eligible = rows
      .map(r => ({ ...r, tokens: new Set<string>(JSON.parse(r.body_tokens)) }))
      .filter(r => r.normalized_body.split('\n').filter(Boolean).length >= 4 && r.tokens.size > 0)

    const exhaustive = new Set<string>()
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const a = eligible[i]
        const b = eligible[j]
        if (a.file_path === b.file_path && a.start_line === b.start_line) {continue}
        const shared = [...a.tokens].filter(t => b.tokens.has(t)).length
        const union = a.tokens.size + b.tokens.size - shared
        if (shared / union >= 0.75) {
          exhaustive.add([`${a.file_path}:${a.start_line}`, `${b.file_path}:${b.start_line}`].sort().join('|'))
        }
      }
    }

    const found = new Set(
      new DuplicateMethodDetector(db).findDuplicates().map(p =>
        [`${p.a.filePath}:${p.a.startLine}`, `${p.b.filePath}:${p.b.startLine}`].sort().join('|'),
      ),
    )

    expect(exhaustive.size).toBeGreaterThan(0)
    expect([...found].sort()).toEqual([...exhaustive].sort())
  })
})
