# frozen_string_literal: true

require 'pathname'

module RubyLsp
  module RailsForge
    # Go-to-definition for Rails conventions ruby-lsp can't resolve statically:
    #   users_path / edit_user_url -> the declaring line in config/routes.rb
    #   render 'users/form' / render partial: 'form' -> app/views/**/_form.*
    class DefinitionListener
      def initialize(response_builder, uri, node_context, routes_index, workspace_path, dispatcher)
        @response_builder = response_builder
        @uri = uri
        @node_context = node_context
        @routes_index = routes_index
        @workspace = Pathname.new(workspace_path)

        dispatcher.register(self, :on_call_node_enter, :on_string_node_enter)
      end

      def on_call_node_enter(node)
        return if node.receiver

        helper = @routes_index.find(node.name)
        return unless helper

        push_location(@routes_index.path, helper.line - 1)
      end

      def on_string_node_enter(node)
        call = @node_context.call_node
        return unless call && call.name == :render && call.receiver.nil?

        partial_files(node.content).each { |file| push_location(file, 0) }
      end

      private

      def partial_files(name)
        return [] if name.empty? || name.include?('..')

        dir, base = File.split(name)
        dir = dir == '.' ? current_view_dir : dir
        return [] unless dir

        Dir.glob(@workspace.join('app', 'views', dir, "_#{base}.*").to_s).sort.map { |f| Pathname.new(f) }
      end

      # `render 'form'` inside app/views/users/edit.html.erb resolves relative to app/views/users.
      def current_view_dir
        relative = Pathname.new(@uri.path.to_s).relative_path_from(@workspace.join('app', 'views')).dirname.to_s
        relative.start_with?('..') ? nil : relative
      rescue ArgumentError
        nil
      end

      def push_location(path, zero_based_line)
        position = Interface::Position.new(line: zero_based_line, character: 0)
        @response_builder << Interface::Location.new(
          uri: URI::Generic.from_path(path: path.to_s).to_s,
          range: Interface::Range.new(start: position, end: position)
        )
      end
    end
  end
end
