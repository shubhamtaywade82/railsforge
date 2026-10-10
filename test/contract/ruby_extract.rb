# Ground truth for the TypeScript source extractors (src/semantic/facts.ts): parses Ruby with
# Ripper (the interpreter's own parser, stdlib) and reports the same facts in the same shape.
#   ruby ruby_extract.rb file1.rb file2.rb ...  -> JSON array on stdout
require 'ripper'
require 'json'

ASSOC = %w[belongs_to has_many has_one has_and_belongs_to_many].freeze
FILTERS = %w[before_action after_action around_action skip_before_action].freeze

def ident(node)
  node.is_a?(Array) && %i[@ident @const @kw].include?(node[0]) ? node[1] : nil
end

def const_name(node)
  case node[0]
  when :const_ref then ident(node[1])
  when :const_path_ref then "#{const_name(node[1])}::#{ident(node[2])}"
  when :var_ref, :top_const_ref then ident(node[1])
  when :@const then node[1]
  end
end

def symbol_value(node)
  return nil unless node.is_a?(Array)
  case node[0]
  when :symbol_literal then ident(node[1][1]) if node[1].is_a?(Array) && node[1][0] == :symbol
  when :dyna_symbol then nil
  end
end

def literal_value(node)
  return nil unless node.is_a?(Array)
  sym = symbol_value(node)
  return sym if sym
  case node[0]
  when :var_ref then { 'true' => true, 'false' => false }.fetch(ident(node[1]), nil)
  when :string_literal
    parts = node[1][1..] || []
    parts.map { |p| p[0] == :@tstring_content ? p[1] : '' }.join
  end
end

# Returns [positional_args, options_hash] for a macro call node (command or paren call).
def call_args(arg_node)
  list = arg_node
  list = list[1] while list.is_a?(Array) && %i[args_add_block arg_paren].include?(list[0]) && list[1].is_a?(Array) && (list[1][0] == :args_add_block || list[0] == :arg_paren)
  list = list[1] if list.is_a?(Array) && list[0] == :args_add_block
  list = [] unless list.is_a?(Array)
  positional = []
  options = {}
  list.each do |a|
    if a.is_a?(Array) && a[0] == :bare_assoc_hash
      a[1].each do |assoc|
        next unless assoc[0] == :assoc_new && assoc[1][0] == :@label
        options[assoc[1][1].chomp(':')] = literal_value(assoc[2])
      end
    else
      positional << a
    end
  end
  [positional, options]
end

# [macro_name, arg_node] for `macro args` and `macro(args)` statements, else nil.
def macro_call(stmt)
  return nil unless stmt.is_a?(Array)
  case stmt[0]
  when :command then [ident(stmt[1]), stmt[2]]
  when :method_add_arg
    fcall = stmt[1]
    fcall.is_a?(Array) && fcall[0] == :fcall ? [ident(fcall[1]), stmt[2]] : nil
  end
end

def visibility_stmt(stmt)
  return nil unless stmt.is_a?(Array) && %i[var_ref vcall].include?(stmt[0])
  name = ident(stmt[1])
  %w[private protected public].include?(name) ? name : nil
end

def find_class(node, modules = [])
  return nil unless node.is_a?(Array)
  if node[0] == :class
    return { name: (modules + [const_name(node[1])]).join('::'), super: node[2] ? const_name(node[2]) : nil, body: node[3] }
  end
  if node[0] == :module
    found = find_class(node[2], modules + [const_name(node[1])])
    return found if found
  end
  node.each do |child|
    next unless child.is_a?(Array)
    found = find_class(child, modules)
    return found if found
  end
  nil
end

def statements(body)
  return [] unless body.is_a?(Array) && body[0] == :bodystmt
  body[1].is_a?(Array) ? body[1] : []
end

def extract(path)
  tree = Ripper.sexp(File.read(path))
  cls = tree && find_class(tree)
  return { 'file' => path, 'class' => nil } unless cls

  out = { 'file' => path, 'class' => cls[:name], 'superclass' => cls[:super],
          'associations' => [], 'validations' => [], 'callbacks' => [], 'scopes' => [],
          'filters' => [], 'public_methods' => [] }
  visibility = 'public'
  statements(cls[:body]).each do |stmt|
    if (v = visibility_stmt(stmt))
      visibility = v
      next
    end
    if stmt[0] == :def
      out['public_methods'] << ident(stmt[1]) if visibility == 'public'
      next
    end
    macro, args = macro_call(stmt)
    next unless macro
    positional, options = call_args(args)
    symbols = positional.map { |p| symbol_value(p) }.compact
    if %w[private protected].include?(macro)
      out['public_methods'] -= symbols # `private :helper` after the def
      next
    end
    if ASSOC.include?(macro) && symbols.first
      out['associations'] << {
        'macro' => macro, 'name' => symbols.first, 'class_name' => options['class_name'],
        'through' => options['through'], 'dependent' => options['dependent'],
        'optional' => options['optional'], 'polymorphic' => options['polymorphic'] == true
      }
    elsif macro == 'validate' || macro == 'validates' || macro =~ /\Avalidates_\w+_of\z/
      out['validations'] << "#{macro}:#{symbols.join(',')}" unless symbols.empty?
    elsif FILTERS.include?(macro)
      symbols.each { |s| out['filters'] << "#{macro}:#{s}" }
    elsif macro =~ /\A(before|after|around)_\w+\z/ && symbols.first
      out['callbacks'] << "#{macro}:#{symbols.first}"
    elsif macro == 'scope' && symbols.first
      out['scopes'] << symbols.first
    end
  end
  out
end

puts JSON.generate(ARGV.map { |p| extract(p) })
