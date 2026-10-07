class OrdersController < ApplicationController
  before_action :authenticate_user!
  before_action :load_order, only: %i[show update]
  before_action :set_a, :set_b
  skip_before_action :verify_authenticity_token, only: :webhook
  around_action :wrap_in_transaction

  def index; end
  def show; end

  def create
    head :ok
  end

  private

  def load_order; end
  def set_a; end
  def set_b; end

  public

  def webhook; end

  protected

  def wrap_in_transaction; yield; end
end
