# railsforge-ruby-lsp

A [ruby-lsp](https://github.com/Shopify/ruby-lsp) add-on. This is **not** an
alternative language server — it plugs into Shopify's `ruby-lsp` (the same
server the `Shopify.ruby-lsp` VS Code/Cursor extension talks to) and appends
RailsForge-specific context to responses ruby-lsp already produces.

## Why a separate gem instead of extension code?

`ruby-lsp` runs as a Ruby process started by the editor extension; its add-on
API (`RubyLsp::Addon`) is how third parties extend it, and add-ons are
discovered from installed gems, not from editor-side TypeScript. Anything
that needs to see Ruby's AST or hook into ruby-lsp's own request handlers has
to live here, on the Ruby side. The RailsForge VS Code extension stays
responsible for panels, commands, CodeLens, and everything else that doesn't
require living inside the language server process.

## What it does today

- Reads `db/schema.rb` (same parsing approach as `SchemaIndexer.ts`).
- Registers a `create_hover_listener` that appends column name/type/nullability
  to ruby-lsp's own Hover response when you hover an attribute read on an
  ActiveRecord model (e.g. `user.email` inside `app/models/user.rb`).

- **Completion** — route helpers (`posts_pa` → `posts_path`, read statically from
  `config/routes.rb`: resources/resource with only/except, namespace, nesting,
  member/collection, `as:`, root) and the current model's schema columns.
- **Go to definition** — a route helper call jumps to its declaration in
  `config/routes.rb`; `render 'users/form'` jumps to `app/views/users/_form.*`.

All of it is additive: it extends ruby-lsp's own responses in place instead of
asking you to run two overlapping language tools, and it never runs application code.

## Install

Add to the Rails app's `Gemfile` (development group), alongside `ruby-lsp`:

```ruby
group :development do
  gem 'ruby-lsp', require: false
  gem 'ruby-lsp-rails', require: false
  gem 'railsforge-ruby-lsp', require: false
end
```

`bundle install`, then restart ruby-lsp in your editor. No separate
configuration is required — ruby-lsp auto-discovers add-ons from installed
gems that depend on `ruby-lsp` and expose a `RubyLsp::Addon` subclass.

## Relationship to the RailsForge VS Code extension

The VS Code extension does **not** require this gem to function — schema
hover, CodeLens, and the pattern catalog work standalone. Installing this
gem is optional and additive: it makes ruby-lsp's *own* hover/completion
(which many other tools also read, e.g. inline AI completions) carry the
same Rails context, instead of that context being available only inside
RailsForge's own UI.
