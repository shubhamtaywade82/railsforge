# frozen_string_literal: true

require 'ruby_lsp/addon'
require_relative 'version'
require_relative 'schema_index'
require_relative 'hover_listener'

module RubyLsp
  module RailsForge
    # Registers RailsForge as a ruby-lsp add-on (see ruby-lsp's `RubyLsp::Addon` API).
    #
    # This is deliberately additive: it never overrides ruby-lsp's own Ruby/Rails
    # intelligence (go-to-definition, diagnostics, completion). It only appends
    # RailsForge-specific schema context onto ruby-lsp's existing Hover responses,
    # so installing this gem alongside the `ruby-lsp` and `ruby-lsp-rails` gems is
    # additive, not a replacement.
    class Addon < ::RubyLsp::Addon
      def activate(global_state, _outgoing_queue)
        workspace_path = global_state.workspace_path
        @schema_index = SchemaIndex.new(workspace_path)
      end

      def deactivate
        @schema_index = nil
      end

      def name
        'RailsForge'
      end

      def version
        VERSION
      end

      # Hook name matches ruby-lsp's listener-registration API
      # (`create_<request>_listener`) used by Hover/Completion/etc.
      def create_hover_listener(response_builder, node_context, dispatcher)
        return unless @schema_index

        HoverListener.new(response_builder, node_context, @schema_index, dispatcher)
      end
    end
  end
end
