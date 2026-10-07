class Order < ApplicationRecord
  belongs_to :user
  has_many :line_items, dependent: :destroy
  has_many :tags, through: :taggings
  has_one :receipt, class_name: 'Billing::Receipt'
  belongs_to :commentable, polymorphic: true, optional: true
  has_and_belongs_to_many :coupons

  validates :number, presence: true
  validates :total, :currency, numericality: true
  validate :must_have_items
  validates_presence_of :user_id, :status

  before_save :normalize_number
  after_commit :notify, on: :create
  around_update :audit

  scope :recent, -> { where('created_at > ?', 1.day.ago) }
  scope :paid, -> { where(status: :paid) }

  def total_cents
    (total * 100).to_i
  end

  def self.build_from(cart)
    new
  end

  private

  def normalize_number
    self.number = number.to_s.strip
  end

  def must_have_items; end
  def notify; end
  def audit; yield; end
end
