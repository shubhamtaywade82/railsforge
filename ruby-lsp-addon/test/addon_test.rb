# frozen_string_literal: true

require 'minitest/autorun'
require 'tmpdir'
require 'fileutils'
require 'ruby_lsp/internal'

# Exercises the add-on through ruby-lsp's own loading and Hover request path, so a
# breaking change to the (experimental) add-on API fails here rather than in a user's editor.
class RailsForgeAddonTest < Minitest::Test
  SCHEMA = <<~RUBY
    ActiveRecord::Schema.define(version: 1) do
      create_table "users", force: :cascade do |t|
        t.string "email", null: false
        t.integer "age"
      end
    end
  RUBY

  MODEL = <<~RUBY
    class User < ApplicationRecord
      def contact
        email
      end

      def years
        age
      end
    end
  RUBY

  def setup
    @dir = Dir.mktmpdir('railsforge-addon')
    FileUtils.mkdir_p(File.join(@dir, 'db'))
    FileUtils.mkdir_p(File.join(@dir, 'app', 'models'))
    File.write(File.join(@dir, 'db', 'schema.rb'), SCHEMA)

    @global_state = RubyLsp::GlobalState.new
    @global_state.apply_options({ workspaceFolders: [{ uri: "file://#{@dir}" }], initializationOptions: {} })
    RubyLsp::Addon.load_addons(@global_state, Thread::Queue.new, include_project_addons: false)
  end

  def teardown
    RubyLsp::Addon.addons.each(&:deactivate)
    RubyLsp::Addon.addons.clear
    FileUtils.remove_entry(@dir)
  end

  def test_addon_is_discovered_and_activated
    addon = RubyLsp::Addon.addons.find { |a| a.name == 'RailsForge' }
    refute_nil addon, 'ruby-lsp did not discover the RailsForge add-on'
    assert_equal RubyLsp::RailsForge::VERSION, addon.version
  end

  def test_hover_on_schema_column_adds_type_and_nullability
    text = hover_text(line: 2, character: 4)
    assert_includes text, '**RailsForge**'
    assert_includes text, '`email`'
    assert_includes text, '`string`'
    assert_includes text, '(NOT NULL)'
    assert_includes text, '`User`'
  end

  def test_nullable_column_has_no_not_null_marker
    text = hover_text(line: 6, character: 4)
    assert_includes text, '`age`'
    refute_includes text, 'NOT NULL'
  end

  def test_hover_without_schema_adds_nothing
    File.delete(File.join(@dir, 'db', 'schema.rb'))
    RubyLsp::Addon.addons.first.activate(@global_state, Thread::Queue.new)
    refute_includes hover_text(line: 2, character: 4).to_s, 'RailsForge'
  end

  private

  def hover_text(line:, character:)
    uri = URI("file://#{@dir}/app/models/user.rb")
    document = RubyLsp::RubyDocument.new(source: MODEL, version: 1, uri: uri, global_state: @global_state)
    dispatcher = Prism::Dispatcher.new
    hover = RubyLsp::Requests::Hover.new(
      document, @global_state, { line: line, character: character }, dispatcher,
      RubyLsp::SorbetLevel.ignore
    )
    hover.perform&.contents&.value.to_s
  end
end
