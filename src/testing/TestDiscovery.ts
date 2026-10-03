/**
 * TestDiscovery - structural parse of RSpec / Minitest files into a group/test tree.
 *
 * Line/indentation based (no Ruby parser): blocks are nested by indentation, which matches
 * how virtually all Ruby test files are formatted (RuboCop's Layout/IndentationWidth).
 */

export type TestFramework = 'rspec' | 'minitest'

export interface TestNode {
  kind: 'group' | 'test'
  name: string
  /** 0-based line. */
  line: number
  children: TestNode[]
}

const RSPEC_GROUP = /^(\s*)(?:RSpec\.)?(?:describe|context|feature|xdescribe|xcontext|fdescribe|fcontext|shared_examples_for|shared_examples|shared_context)\b\s*\(?\s*(.*)$/
const RSPEC_TEST = /^(\s*)(?:it|specify|scenario|example|xit|fit|xspecify)\b\s*\(?\s*(["'])((?:\\.|(?!\2).)*)\2/
const MINITEST_CLASS = /^(\s*)class\s+([A-Z]\w*(?:::\w+)*)\s*<\s*[\w:]*(?:Test|TestCase|Spec)\w*\b/
const MINITEST_TEST_STRING = /^(\s*)test\s*\(?\s*(["'])((?:\\.|(?!\2).)*)\2/
const MINITEST_TEST_DEF = /^(\s*)def\s+(test_\w+[?!]?)/

/** First argument of describe/context: a string literal or a constant ("User", Admin::User). */
export function extractGroupName(rest: string): string | undefined {
  const str = /^(["'])((?:\\.|(?!\1).)*)\1/.exec(rest)
  if (str) {return str[2]}
  const constant = /^(::?[A-Z]\w*(?:::\w+)*|[A-Z]\w*(?:::\w+)*)/.exec(rest)
  if (constant) {return constant[1]}
  const symbol = /^:(\w+)/.exec(rest)
  return symbol ? symbol[1] : undefined
}

export function frameworkForPath(filePath: string): TestFramework | undefined {
  const normalized = filePath.replace(/\\/g, '/')
  if (/_spec\.rb$/.test(normalized)) {return 'rspec'}
  if (/_test\.rb$/.test(normalized)) {return 'minitest'}
  return undefined
}

interface Open {
  indent: number
  node: TestNode
}

export function parseTestStructure(text: string, framework: TestFramework): TestNode[] {
  const roots: TestNode[] = []
  const stack: Open[] = []
  const lines = text.split('\n')

  const attach = (node: TestNode, indent: number): void => {
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {stack.pop()}
    const parent = stack[stack.length - 1]?.node
    ;(parent ? parent.children : roots).push(node)
    if (node.kind === 'group') {stack.push({ indent, node })}
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(#.*)?$/.test(line)) {continue}
    const indentOf = (m: RegExpExecArray): number => m[1].length

    if (framework === 'rspec') {
      const group = RSPEC_GROUP.exec(line)
      if (group) {
        const name = extractGroupName(group[2].trim())
        if (name) {attach({ kind: 'group', name, line: i, children: [] }, indentOf(group))}
        continue
      }
      const test = RSPEC_TEST.exec(line)
      if (test) {attach({ kind: 'test', name: test[3], line: i, children: [] }, indentOf(test))}
    } else {
      const cls = MINITEST_CLASS.exec(line)
      if (cls) {
        attach({ kind: 'group', name: cls[2], line: i, children: [] }, indentOf(cls))
        continue
      }
      const str = MINITEST_TEST_STRING.exec(line)
      if (str) {
        attach({ kind: 'test', name: str[3], line: i, children: [] }, indentOf(str))
        continue
      }
      const def = MINITEST_TEST_DEF.exec(line)
      if (def) {attach({ kind: 'test', name: def[2], line: i, children: [] }, indentOf(def))}
    }
  }
  return roots
}

/** All leaf tests, depth-first. */
export function flattenTests(nodes: readonly TestNode[]): TestNode[] {
  return nodes.flatMap(n => (n.kind === 'test' ? [n] : flattenTests(n.children)))
}
