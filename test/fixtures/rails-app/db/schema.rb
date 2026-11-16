ActiveRecord::Schema[7.1].define(version: 2024_01_15_000000) do
  create_table "orders", force: :cascade do |t|
    t.integer "customer_id", null: false
    t.string "status", default: "pending", null: false
    t.integer "total_cents", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["customer_id"], name: "index_orders_on_customer_id"
  end
end
