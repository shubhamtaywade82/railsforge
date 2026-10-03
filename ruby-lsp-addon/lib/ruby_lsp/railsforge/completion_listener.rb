# frozen_string_literal: true

module RubyLsp
  module RailsForge
    # Adds RailsForge completions on top of ruby-lsp's own: route helpers (users_path, edit_user_url)
    # anywhere, and the current model's schema columns inside a model class. Additive only.
    class CompletionListener
      MAX_ITEMS = 50

      def initialize(response_builder, node_context, schema_index, routes_index, dispatcher)
        @response_builder = response_builder
        @node_context = node_context
        @schema_index = schema_index
        @routes_index = routes_index

        dispatcher.register(self, :on_call_node_enter)
      end

      def on_call_node_enter(node)
        return if node.receiver # only bare identifiers (users_pa|, na|)

        prefix = node.name.to_s
        return if prefix.empty?

        add_route_helpers(prefix)
        add_columns(prefix)
      end

      private

      def add_route_helpers(prefix)
        @routes_index.helper_names.select { |n| n.start_with?(prefix) }.first(MAX_ITEMS).each do |name|
          helper = @routes_index.find(name)
          @response_builder << Interface::CompletionItem.new(
            label: name,
            kind: Constant::CompletionItemKind::METHOD,
            label_details: Interface::CompletionItemLabelDetails.new(description: 'route helper'),
            documentation: Interface::MarkupContent.new(
              kind: 'markdown',
              value: "**RailsForge**: route helper declared at `config/routes.rb:#{helper.line}`"
            )
          )
        end
      end

      def add_columns(prefix)
        model = @node_context.nesting.reverse.find { |n| n.is_a?(String) }
        return unless model

        @schema_index.columns_for_model(model).select { |c| c.name.start_with?(prefix) }.first(MAX_ITEMS).each do |column|
          @response_builder << Interface::CompletionItem.new(
            label: column.name,
            kind: Constant::CompletionItemKind::FIELD,
            label_details: Interface::CompletionItemLabelDetails.new(description: column.type),
            documentation: Interface::MarkupContent.new(
              kind: 'markdown',
              value: "**RailsForge**: `#{column.name}` — `#{column.type}`#{column.nullable ? '' : ' (NOT NULL)'} on `#{model}`"
            )
          )
        end
      end
    end
  end
end
