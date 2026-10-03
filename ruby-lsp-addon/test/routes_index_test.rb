# frozen_string_literal: true

require 'minitest/autorun'
require 'tmpdir'
require 'fileutils'
require 'ruby_lsp/railsforge/routes_index'

class RoutesIndexTest < Minitest::Test
  ROUTES = <<~RUBY
    Rails.application.routes.draw do
      root 'home#index'
      get 'about', to: 'pages#about'
      get '/pricing', as: :plans, to: 'pages#pricing'

      resources :posts do
        resources :comments, only: %i[index create]
        member do
          get :preview
        end
        collection do
          get :search
        end
      end

      resources :tags, except: [:destroy]
      resource :profile, only: [:show, :edit]

      namespace :admin do
        resources :users, only: :index
      end
    end
  RUBY

  def setup
    @dir = Dir.mktmpdir('railsforge-routes')
    FileUtils.mkdir_p(File.join(@dir, 'config'))
    File.write(File.join(@dir, 'config', 'routes.rb'), ROUTES)
    @index = RubyLsp::RailsForge::RoutesIndex.new(@dir)
  end

  def teardown
    FileUtils.remove_entry(@dir)
  end

  def test_resources_generate_the_standard_helpers_with_declaration_lines
    %w[posts_path posts_url post_path post_url new_post_path edit_post_path].each do |name|
      assert @index.find(name), "missing #{name}"
    end
    assert_equal 6, @index.find('posts_path').line
  end

  def test_only_and_except_limit_the_helpers
    assert @index.find('post_comments_path')
    refute @index.find('new_post_comment_path')
    refute @index.find('edit_post_comment_path')

    assert @index.find('tags_path')
    assert @index.find('edit_tag_path')
    refute @index.find('destroy_tag_path')
  end

  def test_singular_resource
    assert @index.find('profile_path')
    assert @index.find('edit_profile_path')
    refute @index.find('new_profile_path')
    refute @index.find('profiles_path')
  end

  def test_member_collection_namespace_root_and_as
    assert @index.find('preview_post_path')
    assert @index.find('search_posts_path')
    assert @index.find('admin_users_path')
    assert @index.find('root_path')
    assert @index.find('plans_path')
    assert @index.find('about_path')
  end

  def test_missing_routes_file_is_empty
    empty = RubyLsp::RailsForge::RoutesIndex.new(Dir.mktmpdir)
    assert_empty empty.helper_names
  end
end
