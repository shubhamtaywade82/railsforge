/**
 * RubyAstParser - tree-sitter-backed Ruby AST extraction.
 *
 * This is additive: the existing regex-based indexers (ProjectPatternIndexer,
 * MinimalDependencyGraph, DesignPrincipleLinter) are untouched and keep working
 * exactly as before. This module powers the *new* Phase 8/11/13/14 capabilities
 * that specifically called for real AST parsing instead of line regex — near-duplicate
 * method detection, dependency-cycle detection, and constructor-injection analysis
 * are all much more reliable against an actual parse tree than against `def`/`end`
 * depth counting.
 */

 
const Parser = require('tree-sitter')
 
const Ruby = require('tree-sitter-ruby')

export interface ParsedCall {
  receiver: string | null
  method: string
  line: number
}

export interface ParsedMethod {
  name: string
  isPublic: boolean
  visibility: 'public' | 'private' | 'protected'
  startLine: number
  endLine: number
  bodyText: string
  params: string[]
}

export interface ParsedClass {
  name: string
  superclass: string | null
  startLine: number
  endLine: number
  includes: string[]
  methods: ParsedMethod[]
  calls: ParsedCall[]
}

/** A class or module definition; `kind` is the only difference from ParsedClass. */
export type ParsedTypeDefinition = ParsedClass & { kind: 'class' | 'module' }

interface SyntaxNode {
  type: string
  text: string
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  namedChildren: SyntaxNode[]
  childForFieldName(field: string): SyntaxNode | null
}

export class RubyAstParser {
  private parser: typeof Parser

  constructor() {
    this.parser = new Parser()
    this.parser.setLanguage(Ruby)
  }

  /** Never throws: a file tree-sitter can't parse just yields no classes, not a crash. */
  parseClasses(content: string): ParsedClass[] {
    let tree: { rootNode: SyntaxNode }
    try {
      tree = this.parser.parse(content)
    } catch {
      return []
    }

    const classes: ParsedClass[] = []
    this.walk(tree.rootNode, node => {
      if (node.type === 'class') {
        const parsed = this.extractClass(node)
        if (parsed) {classes.push(parsed)}
      }
    })
    return classes
  }

  /**
   * Classes AND modules (concerns, namespaces), each tagged with `kind`. Additive: `parseClasses`
   * keeps its class-only behavior for the indexers that depend on it. Never throws.
   */
  parseTypeDefinitions(content: string): ParsedTypeDefinition[] {
    let tree: { rootNode: SyntaxNode }
    try {
      tree = this.parser.parse(content)
    } catch {
      return []
    }

    const types: ParsedTypeDefinition[] = []
    this.walk(tree.rootNode, node => {
      if (node.type === 'class' || node.type === 'module') {
        const parsed = this.extractClass(node)
        if (parsed) {types.push({ ...parsed, kind: node.type === 'class' ? 'class' : 'module' })}
      }
    })
    return types
  }

  private walk(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
    visit(node)
    for (const child of node.namedChildren) {
      this.walk(child, visit)
    }
  }

  private extractClass(node: SyntaxNode): ParsedClass | null {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) {return null}

    const superclassNode = node.childForFieldName('superclass')
    const bodyNode = node.childForFieldName('body')

    const includes: string[] = []
    const methods: ParsedMethod[] = []
    const calls: ParsedCall[] = []
    let visibility: ParsedMethod['visibility'] = 'public'

    if (bodyNode) {
      for (const child of bodyNode.namedChildren) {
        if (child.type === 'call') {
          const callInfo = this.extractCallInfo(child)
          if (!callInfo) {continue}

          if ((callInfo.receiver === null) && ['include', 'prepend', 'extend'].includes(callInfo.method)) {
            const argNode = child.childForFieldName('arguments')
            const moduleName = argNode?.namedChildren[0]?.text
            if (moduleName) {includes.push(moduleName)}
            continue
          }

          if (callInfo.receiver === null && ['private', 'protected'].includes(callInfo.method) && child.namedChildren.every(c => c.type !== 'argument_list')) {
            visibility = callInfo.method === 'protected' ? 'protected' : 'private'
            continue
          }

          calls.push(callInfo)
        } else if (child.type === 'identifier' && (child.text === 'private' || child.text === 'protected')) {
          visibility = child.text === 'protected' ? 'protected' : 'private'
        } else if (child.type === 'method') {
          const method = this.extractMethod(child, visibility)
          if (method) {methods.push(method)}
        }

        // Also walk deeper for calls nested inside method bodies (for hard-coded collaborator detection).
        this.collectNestedCalls(child, calls)
      }
    }

    return {
      name: nameNode.text,
      superclass: superclassNode?.namedChildren[0]?.text ?? null,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      includes,
      methods,
      calls,
    }
  }

  private collectNestedCalls(node: SyntaxNode, calls: ParsedCall[]): void {
    if (node.type === 'method') {
      this.walk(node, inner => {
        if (inner.type === 'call') {
          const info = this.extractCallInfo(inner)
          if (info) {calls.push(info)}
        }
      })
    }
  }

  private extractCallInfo(callNode: SyntaxNode): ParsedCall | null {
    const methodNode = callNode.childForFieldName('method')
    if (!methodNode) {return null}
    const receiverNode = callNode.childForFieldName('receiver')
    return {
      receiver: receiverNode?.text ?? null,
      method: methodNode.text,
      line: callNode.startPosition.row + 1,
    }
  }

  private extractMethod(methodNode: SyntaxNode, visibility: ParsedMethod['visibility']): ParsedMethod | null {
    const nameNode = methodNode.childForFieldName('name')
    if (!nameNode) {return null}

    const paramsNode = methodNode.childForFieldName('parameters')
    const params = (paramsNode?.namedChildren ?? []).map(p => this.paramName(p)).filter((p): p is string => p !== null)

    return {
      name: nameNode.text,
      isPublic: visibility === 'public',
      visibility,
      startLine: methodNode.startPosition.row + 1,
      endLine: methodNode.endPosition.row + 1,
      bodyText: methodNode.text,
      params,
    }
  }

  private paramName(paramNode: SyntaxNode): string | null {
    // Handles identifier, keyword_parameter (name: default), optional_parameter (name = default)
    if (paramNode.type === 'identifier') {return paramNode.text}
    const nameNode = paramNode.childForFieldName('name')
    return nameNode?.text ?? null
  }
}
