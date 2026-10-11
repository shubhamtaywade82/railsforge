import { describe, it, expect, vi } from 'vitest'
import { RubyAstParser } from '../src/indexer/RubyAstParser'

const parser = new RubyAstParser()

describe('RubyAstParser', () => {
  it('extracts class name, superclass, public methods, and constructor params', () => {
    const code = `
class CreateOrderService < ApplicationService
  def initialize(user:, payment_gateway: PaymentGateway)
    @user = user
    @payment_gateway = payment_gateway
  end

  def call
    @payment_gateway.charge(@user)
  end

  private

  def log_error
    puts 'error'
  end
end
`
    const [klass] = parser.parseClasses(code)

    expect(klass.name).toBe('CreateOrderService')
    expect(klass.superclass).toBe('ApplicationService')

    const publicMethods = klass.methods.filter(m => m.isPublic).map(m => m.name)
    expect(publicMethods).toEqual(['initialize', 'call'])

    const privateMethods = klass.methods.filter(m => !m.isPublic).map(m => m.name)
    expect(privateMethods).toEqual(['log_error'])

    const initialize = klass.methods.find(m => m.name === 'initialize')!
    expect(initialize.params).toEqual(['user', 'payment_gateway'])
  })

  it('extracts include/prepend/extend module references', () => {
    const code = `
class OrderJob
  include Sidekiq::Job
  prepend Retryable
  extend ActiveSupport::Concern
end
`
    const [klass] = parser.parseClasses(code)
    expect(klass.includes).toEqual(['Sidekiq::Job', 'Retryable', 'ActiveSupport::Concern'])
  })

  it('extracts calls with receivers, including calls nested inside method bodies', () => {
    const code = `
class CreateOrderService < ApplicationService
  def call
    order = Order.create!(user: @user)
    PaymentGatewayService.call(order: order)
    order
  end
end
`
    const [klass] = parser.parseClasses(code)
    const calls = klass.calls.map(c => `${c.receiver}.${c.method}`)

    expect(calls).toContain('Order.create!')
    expect(calls).toContain('PaymentGatewayService.call')
  })

  it('returns an empty array for content it cannot usefully parse, without throwing', () => {
    expect(() => parser.parseClasses('')).not.toThrow()
    expect(parser.parseClasses('')).toEqual([])
  })

  it('extracts multiple top-level classes from one file', () => {
    const code = `
class Foo
  def a; end
end

class Bar
  def b; end
end
`
    const classes = parser.parseClasses(code)
    expect(classes.map(c => c.name)).toEqual(['Foo', 'Bar'])
  })

  it('marks methods after a bare private identifier as non-public, and captures class-level calls', () => {
    const code = `
class Foo
  private

  def secret; end

  validate!
end
`
    const [klass] = parser.parseClasses(code)
    expect(klass.methods.find(m => m.name === 'secret')?.isPublic).toBe(false)
    expect(klass.calls.map(c => c.method)).toContain('validate!')
  })

  it('returns empty array when parser throws an error', () => {
    // Force the parser to throw by mocking the parse method
    const origProto = Object.getPrototypeOf(parser)
    const origParser = (parser as any).parser
    ;(parser as any).parser = {
      parse: () => { throw new Error('forced parse failure') },
      setLanguage: () => {},
    }
    const result = parser.parseClasses('class Foo; end')
    expect(result).toEqual([])
    // Restore
    ;(parser as any).parser = origParser
  })

  it('detects private keyword when parsed as a call node', () => {
    // In some tree-sitter-ruby versions, `private` can be parsed as a call node
    // rather than an identifier. This test ensures both paths work.
    const code = `
class Foo
  private

  def hidden_method
    true
  end
end
`
    const [klass] = parser.parseClasses(code)
    const hidden = klass.methods.find(m => m.name === 'hidden_method')
    expect(hidden).toBeDefined()
    expect(hidden?.isPublic).toBe(false)
  })

  it('returns empty array when the internal parser is null (catches TypeError)', () => {
    // Use a fresh instance to avoid polluting the shared parser
    const p = new RubyAstParser()
    ;(p as any).parser = null
    const result = p.parseClasses('class Foo; end')
    expect(result).toEqual([])
  })

  it('handles protected keyword and marks subsequent methods as non-public', () => {
    const code = `
class Foo
  protected

  def guarded_method
    1
  end
end
`
    const [klass] = parser.parseClasses(code)
    expect(klass.methods.find(m => m.name === 'guarded_method')?.isPublic).toBe(false)
  })
})
