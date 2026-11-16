/**
 * RoutesIndexer - In-memory index of Rails route table and named path helpers
 */

export interface RailsRoute {
  prefix?: string
  verb: string
  uriPattern: string
  controller: string
  action: string
  helperName?: string
}

interface DslScope {
  uriPrefix: string
  controllerPrefix: string
  resourceName: string | null
}

const RESOURCE_ROUTES: Array<[string, string, string]> = [
  ['index', 'GET', ''],
  ['create', 'POST', ''],
  ['new', 'GET', '/new'],
  ['show', 'GET', '/:id'],
  ['update', 'PATCH', '/:id'],
  ['destroy', 'DELETE', '/:id'],
  ['edit', 'GET', '/:id/edit'],
]

const SINGULAR_ROUTES: Array<[string, string, string]> = [
  ['new', 'GET', '/new'],
  ['create', 'POST', ''],
  ['show', 'GET', ''],
  ['update', 'PATCH', ''],
  ['destroy', 'DELETE', ''],
  ['edit', 'GET', '/edit'],
]

const DSL_VERBS = ['get', 'post', 'put', 'patch', 'delete']

export class RoutesIndexer {
  private routes: RailsRoute[] = []
  private helperMap: Map<string, RailsRoute> = new Map()

  parseRoutesTable(content: string): void {
    this.routes = []
    this.helperMap.clear()
    const lines = content.split('\n')

    for (const line of lines) {
      const route = this.parseRouteLine(line)
      if (route) {
        this.routes.push(route)
        if (route.helperName) {
          this.helperMap.set(route.helperName, route)
          this.helperMap.set(`${route.helperName}_path`, route)
          this.helperMap.set(`${route.helperName}_url`, route)
        }
      }
    }
  }

  private parseRouteLine(line: string): RailsRoute | null {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('Prefix') || trimmed.startsWith('--')) {
      return null
    }

    const parts = trimmed.split(/\s+/)
    if (parts.length < 3) {return null}

    let prefix: string | undefined
    let verb: string
    let uriPattern: string
    let controllerAction: string

    if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(parts[0])) {
      verb = parts[0]
      uriPattern = parts[1]
      controllerAction = parts[2]
    } else {
      prefix = parts[0]
      verb = parts[1]
      uriPattern = parts[2]
      controllerAction = parts[3]
    }

    if (!controllerAction || !controllerAction.includes('#')) {
      return null
    }

    const [controller, action] = controllerAction.split('#')
    return {
      prefix,
      verb,
      uriPattern,
      controller,
      action,
      helperName: prefix,
    }
  }

  /**
   * Parses config/routes.rb Ruby DSL source into the same route list the
   * `rails routes` table parser produces. Handles root, verb routes with
   * `to:`, resources (with only/except and nesting), singular resources,
   * namespaces, scopes, and member/collection blocks.
   */
  parseRoutesDsl(content: string): void {
    this.routes = []
    this.helperMap.clear()
    const stack: DslScope[] = [{ uriPrefix: '', controllerPrefix: '', resourceName: null }]

    for (const raw of content.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#') || line.includes('Rails.application.routes.draw')) { continue }
      if (line === 'end') {
        if (stack.length > 1) { stack.pop() }
        continue
      }
      this.parseDslLine(line, stack)
    }
  }

  private parseDslLine(line: string, stack: DslScope[]): void {
    const scope = stack[stack.length - 1]

    if (line.startsWith('root ')) {
      const [controller, action] = this.dslString(line.slice(5)).split('#')
      if (controller && action) {
        this.routes.push({ verb: 'GET', uriPattern: `${scope.uriPrefix}/`, controller: scope.controllerPrefix + controller, action })
      }
      return
    }

    const verb = DSL_VERBS.find(v => line.startsWith(`${v} `))
    if (verb) {
      this.parseDslVerb(verb.toUpperCase(), line, scope)
      return
    }

    if (line.startsWith('namespace ') && line.endsWith('do')) {
      const name = this.dslSymbol(line.slice(10))
      if (name) {
        stack.push({ uriPrefix: `${scope.uriPrefix}/${name}`, controllerPrefix: `${scope.controllerPrefix}${name}/`, resourceName: null })
      }
      return
    }

    if (line.startsWith('scope ')) {
      this.parseDslScope(line, scope, stack)
      return
    }

    if (line.startsWith('resources ')) {
      this.parseDslResources(line, scope, stack)
      return
    }

    if (line.startsWith('resource ')) {
      this.parseDslSingular(line, scope, stack)
      return
    }

    if (line === 'member do' || line === 'collection do') {
      stack.push({
        uriPrefix: line === 'member do' ? `${scope.uriPrefix}/:id` : scope.uriPrefix,
        controllerPrefix: scope.controllerPrefix,
        resourceName: this.nearestResource(stack),
      })
    }
  }

  private parseDslVerb(verb: string, line: string, scope: DslScope): void {
    const target = line.slice(verb.length + 1).trim()
    const toMatch = target.match(/to:\s*["']([^"']+)["']/)
    if (toMatch) {
      const [controller, action] = toMatch[1].split('#')
      if (!controller || !action) { return }
      const path = this.dslString(target.split(',')[0])
      this.routes.push({
        verb,
        uriPattern: `${scope.uriPrefix}/${path.replace(/^\//, '')}`,
        controller: scope.controllerPrefix + controller,
        action,
      })
      return
    }
    const action = this.dslSymbol(target)
    if (action && scope.resourceName) {
      this.routes.push({
        verb,
        uriPattern: `${scope.uriPrefix}/${action}`,
        controller: `${scope.controllerPrefix}${scope.resourceName}`,
        action,
      })
    }
  }

  private parseDslScope(line: string, scope: DslScope, stack: DslScope[]): void {
    const target = line.slice(6).replace(/\s*do\s*$/, '').trim()
    const path = this.dslString(target) || (!target.includes('module:') ? this.dslSymbol(target) : '')
    const moduleMatch = target.match(/module:\s*:(\w+)/)
    if (!path && !moduleMatch) { return }
    const next: DslScope = { ...scope }
    if (path) { next.uriPrefix = `${scope.uriPrefix}/${path.replace(/^\//, '')}` }
    if (moduleMatch) { next.controllerPrefix = `${scope.controllerPrefix}${moduleMatch[1]}/` }
    stack.push(next)
  }

  private parseDslResources(line: string, scope: DslScope, stack: DslScope[]): void {
    const name = this.dslSymbol(line.slice(10))
    if (!name) { return }
    const base = `${scope.uriPrefix}${this.resourceIdPrefix(stack)}/${name}`
    const controller = `${scope.controllerPrefix}${name}`
    const allowed = this.dslRouteFilters(line, RESOURCE_ROUTES.map(r => r[0]))
    for (const [action, verb, uri] of RESOURCE_ROUTES) {
      if (allowed.has(action)) {
        this.routes.push({ verb, uriPattern: base + uri, controller, action })
      }
    }
    if (line.endsWith('do')) {
      stack.push({ uriPrefix: base, controllerPrefix: scope.controllerPrefix, resourceName: name })
    }
  }

  private parseDslSingular(line: string, scope: DslScope, stack: DslScope[]): void {
    const name = this.dslSymbol(line.slice(9))
    if (!name) { return }
    const base = `${scope.uriPrefix}${this.resourceIdPrefix(stack)}/${name}`
    const controller = `${scope.controllerPrefix}${this.pluralize(name)}`
    const allowed = this.dslRouteFilters(line, SINGULAR_ROUTES.map(r => r[0]))
    for (const [action, verb, uri] of SINGULAR_ROUTES) {
      if (allowed.has(action)) {
        this.routes.push({ verb, uriPattern: base + uri, controller, action })
      }
    }
    if (line.endsWith('do')) {
      stack.push({ uriPrefix: base, controllerPrefix: scope.controllerPrefix, resourceName: name })
    }
  }

  private dslRouteFilters(line: string, allActions: string[]): Set<string> {
    const m = line.match(/(only|except):\s*(?:\[([^\]]*)\]|:(\w+)|%i\[([^\]]*)\])/)
    if (!m) { return new Set(allActions) }
    const names = (m[2] ?? m[3] ?? m[4] ?? '').split(/[\s,:]+/).filter(Boolean)
    const selected = new Set(names)
    return m[1] === 'only' ? selected : new Set(allActions.filter(a => !selected.has(a)))
  }

  private nearestResource(stack: DslScope[]): string | null {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].resourceName) { return stack[i].resourceName }
    }
    return null
  }

  private resourceIdPrefix(stack: DslScope[]): string {
    const parent = this.nearestResource(stack)
    return parent ? `/:${this.singularize(parent)}_id` : ''
  }

  private dslSymbol(text: string): string {
    const m = text.match(/:([a-zA-Z_]\w*)/)
    return m ? m[1] : ''
  }

  private dslString(text: string): string {
    const m = text.match(/["']([^"']+)["']/)
    return m ? m[1] : ''
  }

  private pluralize(str: string): string {
    if (str.endsWith('y') && !/[aeiou]y$/.test(str)) { return str.slice(0, -1) + 'ies' }
    return str.endsWith('s') ? str : `${str}s`
  }

  private singularize(str: string): string {
    if (str.endsWith('ies')) { return str.slice(0, -3) + 'y' }
    if (str.endsWith('s') && !str.endsWith('ss')) { return str.slice(0, -1) }
    return str
  }

  findHelper(name: string): RailsRoute | undefined {
    return this.helperMap.get(name)
  }

  searchRoutes(query: string): RailsRoute[] {
    const q = query.toLowerCase()
    return this.routes.filter(r =>
      r.uriPattern.toLowerCase().includes(q) ||
      (r.helperName && r.helperName.toLowerCase().includes(q)) ||
      `${r.controller}#${r.action}`.toLowerCase().includes(q),
    )
  }

  getAllRoutes(): RailsRoute[] {
    return this.routes
  }
}
