module Logistics
  class Shipment < ApplicationRecord
    has_many(:parcels, dependent: :nullify)
    belongs_to :order,
               optional: true,
               class_name: "Order"
    validates(:tracking_number, uniqueness: true)
    scope(:late, -> { where("eta < ?", Time.now) })
    before_validation :compact_tracking

    def label; end

    protected

    def compact_tracking; end
  end
end
