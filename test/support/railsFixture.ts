import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export const FIXTURE_FILES: Record<string, string> = {
  'db/schema.rb': `ActiveRecord::Schema.define(version: 1) do
  create_table "orders", force: :cascade do |t|
    t.integer "user_id", null: false
    t.string "number"
    t.index ["number"], name: "idx_number", unique: true
  end
  create_table "line_items", force: :cascade do |t|
    t.integer "order_id", null: false
  end
  create_table "users", force: :cascade do |t|
    t.string "email", null: false
  end
  add_foreign_key "orders", "users"
  add_foreign_key "line_items", "orders"
end
`,
  'config/routes.rb': `Rails.application.routes.draw do
  resources :orders, only: %i[index show]
  namespace :admin do
    resources :users, only: :index
  end
end
`,
  'app/controllers/orders_controller.rb': `class OrdersController < ApplicationController
  before_action :authenticate_user!

  def index
    @orders = Order.all
  end

  def show
    @order = Order.find(params[:id])
  end

  private

  def secret_helper; end
end
`,
  'app/controllers/admin/users_controller.rb': `module Admin
  class UsersController < ApplicationController
    def index; end
  end
end
`,
  'app/models/order.rb': `class Order < ApplicationRecord
  belongs_to :user
  has_many :line_items, dependent: :destroy
  validates :number, presence: true
  before_save :normalize_number
  scope :recent, -> { order(created_at: :desc) }
end
`,
  'app/models/line_item.rb': `class LineItem < ApplicationRecord
  belongs_to :order
end
`,
  'app/models/user.rb': `class User < ApplicationRecord
  has_many :orders
end
`,
  'app/policies/order_policy.rb': `class OrderPolicy
  def show?; true; end
end
`,
  'app/services/create_order.rb': `class CreateOrder
  def call(user)
    Order.create!(user: user)
  end
end
`,
  'app/views/orders/index.html.erb': `<%= render 'orders/order' %>
<%= render partial: 'summary' %>
`,
  'app/views/orders/_order.html.erb': `<p>order</p>
`,
  'app/views/orders/_summary.html.erb': `<p>summary</p>
`,
  'app/views/orders/show.html.erb': `<h1>Order</h1>
`,
  'spec/models/order_spec.rb': `require 'rails_helper'
RSpec.describe Order, type: :model do
  it 'is valid' do
  end
end
`,
  'db/migrate/20260101_create_orders.rb': `class CreateOrders < ActiveRecord::Migration[7.1]
  def change
    create_table :orders do |t|
    end
    add_index :orders, :number
  end
end
`,
}

/** Writes the mini Rails app to a temp dir and returns its root. */
export function writeRailsFixture(extra: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-rails-'))
  for (const [rel, content] of Object.entries({ ...FIXTURE_FILES, ...extra })) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}
