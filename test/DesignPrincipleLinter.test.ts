import { describe, it, expect } from 'vitest'
import { DesignPrincipleLinter, PrincipleDiagnostic } from '../src/principles/DesignPrincipleLinter'

describe('DesignPrincipleLinter', () => {
  const linter = new DesignPrincipleLinter()

  it('detects Law of Demeter violations in deep chained calls', () => {
    const lines = [
      'def user_city',
      '  user.account.billing.address.city',
      'end',
    ]

    const list: PrincipleDiagnostic[] = []
    linter['checkLawOfDemeter'](lines, list)

    expect(list.length).toBe(1)
    expect(list[0].id).toBe('DEMETER-VIOLATION')
    expect(list[0].line).toBe(2)
    expect(list[0].demeter).toEqual({ receiver: 'user', method: 'city' })
  })

  it('ignores standard Enumerable and data transformation pipelines for Law of Demeter', () => {
    const lines = [
      'def tool_definitions',
      '  @tools.keys.sort.map do |key|',
      '    key.to_s',
      '  end',
      '  @api_keys = source.api_keys.dup.freeze',
      '  item = self.class.global_queue.shift',
      'end',
    ]

    const list: PrincipleDiagnostic[] = []
    linter['checkLawOfDemeter'](lines, list)

    expect(list.length).toBe(0)
  })

  it('ignores ActiveRecord query builder chains and utility roots for Law of Demeter', () => {
    const lines = [
      'def active_emails',
      '  User.where(active: true).order(:created_at).limit(10).pluck(:email)',
      '  Rails.application.config.action_mailer.default_url_options',
      'end',
    ]

    const list: PrincipleDiagnostic[] = []
    linter['checkLawOfDemeter'](lines, list)

    expect(list.length).toBe(0)
  })

  it('ignores dotted numbers and string literals for Law of Demeter', () => {
    const lines = [
      '  def reveal(ip: "203.0.113.10")',
      "  host = 'api.v1.example.com'",
      '  version = 1.2',
    ]

    const list: PrincipleDiagnostic[] = []
    linter['checkLawOfDemeter'](lines, list)

    expect(list.length).toBe(0)
  })

  it('flags dynamic metaprogramming for KISS principle', () => {
    const lines = [
      'class DynamicModel',
      '  define_method :custom_action do',
      '    # complex logic',
      '  end',
      'end',
    ]

    const list: PrincipleDiagnostic[] = []
    linter['checkKISS'](lines, list)

    expect(list.length).toBe(1)
    expect(list[0].id).toBe('KISS-METAPROGRAMMING')
    expect(list[0].line).toBe(2)
  })

  it('identifies unused private methods for YAGNI principle', () => {
    const lines = [
      'class UserService',
      '  def call',
      '    true',
      '  end',
      '  private',
      '  def unused_dead_method',
      '    123',
      '  end',
      'end',
    ]

    const list: PrincipleDiagnostic[] = []
    linter['checkYAGNI'](lines, list)

    expect(list.length).toBe(1)
    expect(list[0].id).toBe('YAGNI-UNUSED-PRIVATE')
    expect(list[0].line).toBe(6)
    expect(list[0].endLine).toBe(8)
  })

  it('flags fat classes in a gem/script lib/ directory without the Rails-specific quick fix', () => {
    const lines = Array.from({ length: 201 }, (_, i) => `  # line ${i}`)
    lines.unshift('class BigGemClass')
    lines.push('end')

    const list: PrincipleDiagnostic[] = []
    linter['checkSRP']('/repo/lib/my_gem/big_gem_class.rb', lines, list)

    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('SRP-FAT-CLASS')
    expect(list[0].quickFixCommand).toBeUndefined()
  })

  it('does not flag a lib/ file that lives under an unrelated app/ workspace path', () => {
    const lines = Array.from({ length: 201 }, () => '  # line')

    const list: PrincipleDiagnostic[] = []
    linter['checkSRP']('/repo/app/lib_looking_dir/lib/thing.rb', lines, list)

    expect(list).toHaveLength(0)
  })
})
