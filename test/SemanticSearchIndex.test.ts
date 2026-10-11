import { describe, it, expect, vi } from 'vitest'
import { ProjectPatternIndexer } from '../src/patterns/ProjectPatternIndexer'
import { SemanticSearchIndex, EmbedFn } from '../src/search/SemanticSearchIndex'

const files: Record<string, string> = {
  '/repo/app/services/charge_card_service.rb': `
class ChargeCardService < ApplicationService
  def call
    PaymentGateway.charge(@user, @amount)
  end
end
`,
  '/repo/app/services/send_welcome_email_service.rb': `
class SendWelcomeEmailService < ApplicationService
  def call
    UserMailer.welcome(@user).deliver_later
  end
end
`,
}

function buildIndexer(): ProjectPatternIndexer {
  const indexer = new ProjectPatternIndexer()
  for (const [path, content] of Object.entries(files)) {
    indexer.indexFile(path, content)
  }
  return indexer
}

/** Deterministic fake embeddings: vectors are closer when the text shares more words. */
function fakeEmbed(text: string): number[] {
  const dims = ['charge', 'card', 'payment', 'welcome', 'email', 'mailer']
  return dims.map(d => (text.toLowerCase().includes(d) ? 1 : 0))
}

describe('SemanticSearchIndex', () => {
  it('ranks the closest pattern first using semantic (embedding) similarity', async () => {
    const indexer = buildIndexer()
    const embed: EmbedFn = async text => fakeEmbed(text)
    const index = new SemanticSearchIndex(indexer, embed)

    const results = await index.search('charge a payment card')

    expect(results[0].pattern.name).toBe('ChargeCardService')
    expect(results[0].matchedBy).toBe('semantic')
  })

  it('falls back to keyword search when the embed function is unavailable', async () => {
    const indexer = buildIndexer()
    const embed: EmbedFn = async () => null
    const index = new SemanticSearchIndex(indexer, embed)

    const results = await index.search('welcome email')

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].pattern.name).toBe('SendWelcomeEmailService')
    expect(results[0].matchedBy).toBe('keyword')
  })

  it('returns no results for an empty or whitespace-only query', async () => {
    const indexer = buildIndexer()
    const index = new SemanticSearchIndex(indexer, async () => null)

    expect(await index.search('')).toEqual([])
    expect(await index.search('   ')).toEqual([])
  })

  it('caches embeddings per pattern and only re-embeds when content changes', async () => {
    const indexer = buildIndexer()
    const embed = vi.fn(async (text: string) => fakeEmbed(text))
    const index = new SemanticSearchIndex(indexer, embed)

    await index.search('charge a card')
    const callsAfterFirstSearch = embed.mock.calls.length

    await index.search('charge a card again')
    expect(embed.mock.calls.length).toBe(callsAfterFirstSearch + 1) // +1 for the new query embedding only

    indexer.indexFile('/repo/app/services/charge_card_service.rb', files['/repo/app/services/charge_card_service.rb'] + '\n# changed')
    await index.search('charge a card once more')
    expect(embed.mock.calls.length).toBeGreaterThan(callsAfterFirstSearch + 1) // re-embedded the changed pattern too
  })

  it('drops cached embeddings for patterns removed from the indexer', async () => {
    const indexer = buildIndexer()
    const index = new SemanticSearchIndex(indexer, async text => fakeEmbed(text))

    await index.search('charge a card')
    indexer.removeFile('/repo/app/services/charge_card_service.rb')
    index.pruneStale()

    const results = await index.search('charge a card')
    expect(results.every(r => r.pattern.name !== 'ChargeCardService')).toBe(true)
  })

  it('ranks and sorts multiple semantic results by score', async () => {
    const indexer = new ProjectPatternIndexer()
    indexer.indexFile('/repo/app/services/charge_card_service.rb', files['/repo/app/services/charge_card_service.rb'])
    indexer.indexFile('/repo/app/services/payment_service.rb', `
class PaymentService < ApplicationService
  def call
    PaymentGateway.charge(@user, @amount)
  end
end
`)
    const embed: EmbedFn = async text => fakeEmbed(text)
    const index = new SemanticSearchIndex(indexer, embed)

    const results = await index.search('charge a payment card')
    expect(results.length).toBeGreaterThan(1)
    expect(results[0].matchedBy).toBe('semantic')
    // Verify results are sorted by descending score
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  it('ranks and sorts multiple keyword results by score', async () => {
    const indexer = new ProjectPatternIndexer()
    indexer.indexFile('/repo/app/services/send_welcome_email_service.rb', `
class SendWelcomeEmailService < ApplicationService
  def call
    UserMailer.welcome_email(@user).deliver_later
  end
end
`)
    indexer.indexFile('/repo/app/services/send_password_reset_email_service.rb', `
class SendPasswordResetEmailService < ApplicationService
  def call
    UserMailer.password_reset_email(@user).deliver_later
  end
end
`)
    const index = new SemanticSearchIndex(indexer, async () => null)

    const results = await index.search('email')
    expect(results.length).toBeGreaterThan(1)
    expect(results.every(r => r.matchedBy === 'keyword')).toBe(true)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })
})
