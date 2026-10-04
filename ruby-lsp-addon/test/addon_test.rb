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

  ROUTES = <<~RUBY
    Rails.application.routes.draw do
      resources :posts
    end
  RUBY

  CONTROLLER = <<~RUBY
    class PostsController < ApplicationController
      def index
        redirect_to posts_path
      end

      def show
        render 'posts/form'
      end

      def complete_me
        posts_pa
      end
    end
  RUBY

  def setup
    @dir = Dir.mktmpdir('railsforge-addon')
    FileUtils.mkdir_p(File.join(@dir, 'db'))
    FileUtils.mkdir_p(File.join(@dir, 'app', 'models'))
    File.write(File.join(@dir, 'db', 'schema.rb'), SCHEMA)
    FileUtils.mkdir_p(File.join(@dir, 'config'))
    File.write(File.join(@dir, 'config', 'routes.rb'), ROUTES)
    FileUtils.mkdir_p(File.join(@dir, 'app', 'views', 'posts'))
    File.write(File.join(@dir, 'app', 'views', 'posts', '_form.html.erb'), "<%= form %>\n")

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

  def test_completion_offers_route_helpers
    labels = completion_labels(MODEL.sub('email', 'posts_pa'), line: 2, character: 12, path: 'app/models/user.rb')
    assert_includes labels, 'posts_path'
    refute_includes labels, 'new_post_path'
  end

  def test_completion_offers_schema_columns_inside_a_model
    labels = completion_labels(MODEL.sub('email', 'ema'), line: 2, character: 7, path: 'app/models/user.rb')
    assert_includes labels, 'email'
    refute_includes labels, 'age'
  end

  def test_definition_jumps_from_route_helper_to_routes_rb
    locations = definition_locations(CONTROLLER, line: 2, character: 17, path: 'app/controllers/posts_controller.rb')
    assert_equal 1, locations.size
    assert_equal "file://#{@dir}/config/routes.rb", locations.first.uri
    assert_equal 1, locations.first.range.start.line # `resources :posts` is line 2 (0-based 1)
  end

  def test_definition_jumps_from_render_to_the_partial
    locations = definition_locations(CONTROLLER, line: 6, character: 15, path: 'app/controllers/posts_controller.rb')
    assert_equal ["file://#{@dir}/app/views/posts/_form.html.erb"], locations.map(&:uri)
  end

  def test_definition_ignores_unknown_helpers
    assert_empty definition_locations("nothing_path\n", line: 0, character: 3, path: 'app/models/x.rb')
  end

  private

  def completion_labels(source, line:, character:, path:)
    uri = URI("file://#{@dir}/#{path}")
    document = RubyLsp::RubyDocument.new(source: source, version: 1, uri: uri, global_state: @global_state)
    request = RubyLsp::Requests::Completion.new(
      document, @global_state, { position: { line: line, character: character }, context: {} },
      RubyLsp::SorbetLevel.ignore, Prism::Dispatcher.new
    )
    request.perform.map(&:label)
  end

  def definition_locations(source, line:, character:, path:)
    uri = URI("file://#{@dir}/#{path}")
    document = RubyLsp::RubyDocument.new(source: source, version: 1, uri: uri, global_state: @global_state)
    request = RubyLsp::Requests::Definition.new(
      document, @global_state, { line: line, character: character }, Prism::Dispatcher.new, RubyLsp::SorbetLevel.ignore
    )
    Array(request.perform).select { |l| l.respond_to?(:uri) && l.uri.to_s.start_with?("file://#{@dir}") }
  end

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
