Gem::Specification.new do |spec|
  spec.name          = 'railsforge-ruby-lsp'
  spec.version       = begin
    File.read(File.join(__dir__, 'lib/ruby_lsp/railsforge/version.rb'))[/VERSION = '([^']+)'/, 1]
  end
  spec.authors       = ['RailsForge']
  spec.summary       = 'Ruby LSP add-on that injects RailsForge schema/route awareness into ruby-lsp completion and hover.'
  spec.description   = <<~DESC
    RailsForge does not replace ruby-lsp. This gem is a ruby-lsp add-on (RubyLsp::Addon)
    that augments ruby-lsp's own hover and completion responses with Rails-specific
    context (ActiveRecord column names/types, route helpers) sourced from the same
    db/schema.rb and config/routes.rb parsing RailsForge's VS Code side already does.
    Install it alongside Shopify's ruby-lsp gem; ruby-lsp discovers and loads it
    automatically via the addon API.
  DESC
  spec.homepage      = 'https://github.com/shubhamtaywade82/ruby-rails-extension'
  spec.license       = 'MIT'
  spec.required_ruby_version = '>= 3.0'

  spec.files         = Dir['lib/**/*.rb', 'sig/**/*.rbs', 'README.md']
  spec.require_paths = ['lib']

  spec.add_dependency 'ruby-lsp', '>= 0.19'
end
