ActiveRecord::Schema.define(version: 1) do
  create_table "betas", force: :cascade do |t|
    t.string "name"
  end
end
