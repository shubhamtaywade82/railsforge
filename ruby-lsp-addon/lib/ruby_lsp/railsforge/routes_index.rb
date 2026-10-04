# frozen_string_literal: true

require 'pathname'

module RubyLsp
  module RailsForge
    # Static reader for config/routes.rb producing route helper names (users_path, edit_user_url, ...)
    # with the line they are declared on. Mirrors what RoutesIndexer.ts does on the VS Code side:
    # resources/resource (only/except), namespace, nested resources, member/collection, `as:`, root.
    # Deliberately heuristic (no Ruby evaluation) — it never runs application code.
    class RoutesIndex
      Helper = Struct.new(:name, :line, keyword_init: true)

      RESOURCE_ACTIONS = {
        'index' => [:plural],
        'create' => [:plural],
        'new' => %i[new],
        'show' => [:singular],
        'update' => [:singular],
        'destroy' => [:singular],
        'edit' => %i[edit]
      }.freeze

      def initialize(workspace_path)
        @path = Pathname.new(workspace_path).join('config', 'routes.rb')
        @helpers = {}
        reload
      end

      attr_reader :path

      def reload
        @helpers = {}
        return unless @path.exist?

        parse(@path.readlines)
      end

      def helper_names
        @helpers.keys
      end

      # Helper (path or url) -> Helper struct with its declaration line, or nil.
      def find(method_name)
        @helpers[method_name.to_s]
      end

      private

      Scope = Struct.new(:kind, :prefix, :resource, keyword_init: true)

      def parse(lines)
        stack = [Scope.new(kind: :root, prefix: [], resource: nil)]

        lines.each_with_index do |raw, index|
          line = raw.sub(/#.*/, '').strip
          next if line.empty?

          number = index + 1
          opens_block = line.match?(/\bdo(\s*\|[^|]*\|)?\s*\z/)

          if (scope = handle_line(line, number, stack, opens_block))
            stack.push(scope)
          elsif opens_block
            stack.push(Scope.new(kind: :neutral, prefix: stack.last.prefix, resource: stack.last.resource))
          end

          stack.pop if line == 'end' && stack.size > 1
        end
      end

      # Returns a Scope to push when the line opens one, nil otherwise.
      def handle_line(line, number, stack, opens_block)
        current = stack.last

        if (m = line.match(/\Anamespace\s+:(\w+)/))
          return Scope.new(kind: :namespace, prefix: current.prefix + [m[1]], resource: nil) if opens_block
        elsif (m = line.match(/\Aresources\s+:(\w+)(.*)/))
          add_resource(m[1], m[2], number, current, plural: true)
          return Scope.new(kind: :resources, prefix: current.prefix, resource: m[1]) if opens_block
        elsif (m = line.match(/\Aresource\s+:(\w+)(.*)/))
          add_resource(m[1], m[2], number, current, plural: false)
          return Scope.new(kind: :resource, prefix: current.prefix, resource: m[1]) if opens_block
        elsif line.match?(/\A(member|collection)\s+do\z/)
          return Scope.new(kind: line.start_with?('member') ? :member : :collection, prefix: current.prefix, resource: current.resource)
        elsif line.match?(/\Aroot\b/)
          add("root_#{'path'}", number)
          add('root_url', number)
        elsif (m = line.match(/\A(?:get|post|put|patch|delete|match)\s+(.+)/))
          add_verb_route(m[1], number, current)
        end
        nil
      end

      def add_resource(plural_name, options, number, scope, plural:)
        actions = actions_for(options, plural)
        singular = singularize(plural_name)
        base = (scope.prefix + (scope.kind == :resources ? [singularize(scope.resource)] : [])).join('_')
        prefix = base.empty? ? '' : "#{base}_"
        as = options[/as:\s*:(\w+)/, 1]
        collection_name = as || plural_name
        member_name = as || (plural ? singular : plural_name)

        actions.each do |action|
          case action
          when 'index', 'create'
            add_pair("#{prefix}#{collection_name}", number) if plural
          when 'show', 'update', 'destroy'
            add_pair("#{prefix}#{member_name}", number)
          when 'new'
            add_pair("new_#{prefix}#{member_name}", number)
          when 'edit'
            add_pair("edit_#{prefix}#{member_name}", number)
          end
        end
        # Singular resources have no index but expose the member helper.
        add_pair("#{prefix}#{member_name}", number) unless plural
      end

      def actions_for(options, plural)
        all = plural ? %w[index create new show update destroy edit] : %w[create new show update destroy edit]
        if (only = options[/only:\s*(%i\[[^\]]*\]|\[[^\]]*\]|:\w+)/, 1])
          names = only.scan(/\w+/)
          return all.select { |a| names.include?(a) }
        end
        if (except = options[/except:\s*(%i\[[^\]]*\]|\[[^\]]*\]|:\w+)/, 1])
          names = except.scan(/\w+/)
          return all.reject { |a| names.include?(a) }
        end
        all
      end

      def add_verb_route(rest, number, scope)
        as = rest[/as:\s*:(\w+)/, 1]
        name = as || rest[/\A(?::|['"]\/?)(\w+)/, 1]
        return unless name

        name = "#{name}_#{singularize(scope.resource)}" if scope.kind == :member && !as && scope.resource
        name = "#{name}_#{scope.resource}" if scope.kind == :collection && !as && scope.resource
        parts = scope.prefix.dup
        parts << name
        add_pair(parts.join('_'), number)
      end

      def add_pair(base, number)
        add("#{base}_path", number)
        add("#{base}_url", number)
      end

      def add(name, number)
        @helpers[name] ||= Helper.new(name: name, line: number)
      end

      def singularize(word)
        return word if word.nil?
        return "#{word[0..-4]}y" if word.end_with?('ies')
        return word if word.end_with?('ss', 'us')
        return word[0..-2] if word.end_with?('s')

        word
      end
    end
  end
end
