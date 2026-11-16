class CancelOrderService
  def initialize(order)
    @order = order
  end

  def call
    @order.update!(status: 'cancelled')
  end
end
