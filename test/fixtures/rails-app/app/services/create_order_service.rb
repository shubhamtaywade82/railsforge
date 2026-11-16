class CreateOrderService
  def initialize(customer)
    @customer = customer
  end

  def call
    Order.create!(customer_id: @customer.id)
  end
end
