ActiveRecord::Schema.define(version: 1) do
  create_table "alphas", force: :cascade do |t|
    t.string "name"
  end
end
