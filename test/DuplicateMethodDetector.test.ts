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
describe.skipIf(!isPersistentIndexSupported())('DuplicateMethodDetector', () => {
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

})
