class Divergences < ApplicationRecord
  NOTE = <<~TEXT
    validates :fake_in_heredoc, presence: true
  TEXT

  has_many :orders, dependent: :destroy, inverse_of: :divergences
  has_many :late_orders,
           -> { where(late: true) },
           class_name: "Order"

  def kept; end
  def hidden; end
  private :hidden
end
