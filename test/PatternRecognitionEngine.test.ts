import { describe, it, expect } from 'vitest'
import { PatternRecognitionEngine } from '../src/patterns/PatternRecognitionEngine'

describe('PatternRecognitionEngine', () => {
  const engine = new PatternRecognitionEngine()

  it('detects conditional strategy pattern opportunity for multi-branch case statements', () => {
    const code = `
def calculate_tax(order)
  case order.country
  when "US"
    order.amount * 0.08
  when "UK"
    order.amount * 0.20
  when "CA"
    order.amount * 0.13
  else
    0
  end
end
`
    const opps = engine.analyzeCode(code, '/app/services/tax_calculator.rb')
    const strategy = opps.find(o => o.id === 'REPLACE-CONDITIONAL-STRATEGY')

    expect(strategy).toBeDefined()
    expect(strategy?.patternName).toBe('Strategy Pattern')
    expect(strategy?.refactoringGuruUrl).toContain('strategy/ruby')
  })

  it('does not flag case with fewer than 3 when branches as strategy opportunity', () => {
    const code = `
def handle_event(event)
  case event.type
  when "click"
    process_click(event)
  when "hover"
    process_hover(event)
  end
end
`
    const opps = engine.analyzeCode(code, '/app/services/event_handler.rb')
    const strategy = opps.find(o => o.id === 'REPLACE-CONDITIONAL-STRATEGY')
    expect(strategy).toBeUndefined()
  })

  it('detects Singleton anti-pattern hazard', () => {
    const code = `
class AppConfig
  include Singleton
  attr_accessor :api_key
end
`
    const opps = engine.analyzeCode(code, '/app/models/app_config.rb')
    const singleton = opps.find(o => o.id === 'SINGLETON-HAZARD')

    expect(singleton).toBeDefined()
    expect(singleton?.category).toBe('creational')
  })

  it('detects Singleton hazard for @@instance class variable', () => {
    const code = `
class Cache
  @@instance = nil

  def self.instance
    @@instance ||= new
  end
end
`
    const opps = engine.analyzeCode(code, '/app/models/cache.rb')
    const singleton = opps.find(o => o.id === 'SINGLETON-HAZARD')
    expect(singleton).toBeDefined()
  })

  it('detects Primitive Obsession smell for value object candidates', () => {
    const code = `
class Account
  def update_balance(amount_cents, currency)
    # logic
  end
end
`
    const opps = engine.analyzeCode(code, '/app/models/account.rb')
    const valueObj = opps.find(o => o.id === 'PRIMITIVE-OBSESSION')

    expect(valueObj).toBeDefined()
    expect(valueObj?.refactoringGuruUrl).toContain('primitive-obsession')
  })

  it('detects Primitive Obsession in validates calls', () => {
    const code = `
class Event
  validates :start_date, presence: true
  validates :end_date, presence: true
end
`
    const opps = engine.analyzeCode(code, '/app/models/event.rb')
    const valueObj = opps.find(o => o.id === 'PRIMITIVE-OBSESSION')
    expect(valueObj).toBeDefined()
    expect(valueObj?.message).toContain('Value Object')
  })

  it('detects Facade opportunity when many service/client/gateway calls are present', () => {
    const code = `
class CheckoutService
  def process(order)
    PaymentService.charge(order)
    InventoryClient.reserve(order.items)
    NotificationService.confirm(order)
    AuditGateway.log(order)
    ShippingService.schedule(order)
  end
end
`
    const opps = engine.analyzeCode(code, '/app/services/checkout_service.rb')
    const facade = opps.find(o => o.id === 'INTRODUCE-FACADE')
    expect(facade).toBeDefined()
    expect(facade?.patternName).toBe('Facade Pattern')
    expect(facade?.category).toBe('structural')
    expect(facade?.message).toContain('clients/services')
  })

  it('does not flag Facade opportunity for fewer than 4 subsystem calls', () => {
    const code = `
class SimpleService
  PaymentService.charge(order)
  NotificationService.confirm(order)
end
`
    const opps = engine.analyzeCode(code, '/app/services/simple_service.rb')
    const facade = opps.find(o => o.id === 'INTRODUCE-FACADE')
    expect(facade).toBeUndefined()
  })

  it('detects Form Object opportunity in controllers with complex nested params', () => {
    const code = `
class OrdersController < ApplicationController
  def create
    @order = Order.new(order_params)
    if @order.save
      redirect_to @order
    end
  end

  private

  def order_params
    params.require(:order).permit(:name, :email, address_attributes: [:street, :city, :zip])
    params.require(:order).permit(line_items_attributes: [:product_id, :quantity])
  end
end
`
    const opps = engine.analyzeCode(code, '/app/controllers/orders_controller.rb')
    const formObj = opps.find(o => o.id === 'INTRODUCE-FORM-OBJECT')
    expect(formObj).toBeDefined()
    expect(formObj?.patternName).toBe('Form Object Pattern')
    expect(formObj?.category).toBe('structural')
  })

  it('does not flag Form Object opportunity outside controllers', () => {
    const code = `
class Order
  def order_params
    params.require(:order).permit(:name, address_attributes: [:street], items_attributes: [:qty])
  end
end
`
    const opps = engine.analyzeCode(code, '/app/models/order.rb')
    const formObj = opps.find(o => o.id === 'INTRODUCE-FORM-OBJECT')
    expect(formObj).toBeUndefined()
  })

  it('detects Form Object opportunity with :[] style nested params', () => {
    const code = `
class RegistrationsController < ApplicationController
  def create
    params.require(:user).permit(:email, :[], :[])
    params.require(:user).permit(:[], profile_attributes: [:name])
  end
end
`
    const opps = engine.analyzeCode(code, '/app/controllers/registrations_controller.rb')
    const formObj = opps.find(o => o.id === 'INTRODUCE-FORM-OBJECT')
    expect(formObj).toBeDefined()
  })
})
