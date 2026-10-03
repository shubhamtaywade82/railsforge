import { describe, it, expect } from 'vitest'
import { buildSemanticGraph } from '../src/semantic/GraphBuilder'
import { RailsSemanticGraph } from '../src/semantic/RailsSemanticGraph'
import { buildSemanticContext, renderGraphOverview } from '../src/semantic/RailsContextBuilder'
import { publicMethods, viewKeyFor } from '../src/semantic/facts'
import { camelize, singularize, tableNameFor, underscore } from '../src/semantic/inflect'
import { writeRailsFixture } from './support/railsFixture'

const root = writeRailsFixture()
const graph = buildSemanticGraph(root, { runtimeSnapshot: null })
const targets = (id: string, kind: string, dir: 'out' | 'in' = 'out'): string[] =>
  graph.neighbors(id, { kinds: [kind as never], direction: dir }).map(n => n.entity.id)

describe('inflect', () => {
  it('handles the conventional cases', () => {
    expect(singularize('line_items')).toBe('line_item')
    expect(singularize('categories')).toBe('category')
    expect(singularize('addresses')).toBe('address')
    expect(tableNameFor('Admin::LineItem')).toBe('admin_line_items')
    expect(tableNameFor('Person')).toBe('people')
    expect(camelize('admin/orders')).toBe('Admin::Orders')
    expect(underscore('Admin::OrdersController')).toBe('admin/orders_controller')
  })
})

describe('semantic graph facts', () => {
  it('links route -> action -> controller, with the view the action renders', () => {
    expect(targets('route:GET /orders', 'routes_to')).toEqual(['action:OrdersController#index'])
    expect(targets('controller:OrdersController', 'has_action')).toEqual(['action:OrdersController#index', 'action:OrdersController#show'])
    expect(targets('action:OrdersController#index', 'renders')).toEqual(['view:app/views/orders/index'])
    expect(graph.entity('action:OrdersController#index')).toMatchObject({ file: 'app/controllers/orders_controller.rb', line: 4 })
  })

  it('excludes private methods and handles namespaced controllers', () => {
    expect(graph.entity('action:OrdersController#secret_helper')).toBeUndefined()
    expect(graph.entity('controller:Admin::UsersController')).toBeDefined()
    expect(targets('route:GET /admin/users', 'routes_to')).toEqual(['action:Admin::UsersController#index'])
  })

  it('statically extracts associations, validations, callbacks and scopes', () => {
    expect(targets('model:Order', 'belongs_to')).toEqual(['model:User'])
    expect(targets('model:Order', 'has_many')).toEqual(['model:LineItem'])
    const order = graph.entity('model:Order')!
    expect(order.attrs?.validations).toEqual(['validates:number'])
    expect(order.attrs?.callbacks).toEqual(['before_save:normalize_number'])
    expect(order.attrs?.scopes).toEqual(['recent'])
  })

  it('maps models to tables and tables to each other via foreign keys', () => {
    expect(targets('model:Order', 'maps_to_table')).toEqual(['table:orders'])
    expect(targets('table:orders', 'foreign_key')).toEqual(['table:users'])
    expect(graph.entity('table:orders')?.attrs?.indexes).toEqual(['number (unique)'])
  })

  it('links controller<->model, policy authorization, specs, migrations and partials', () => {
    expect(targets('controller:OrdersController', 'related')).toEqual(['model:Order'])
    expect(targets('policy:OrderPolicy', 'authorizes')).toEqual(['model:Order'])
    expect(targets('model:Order', 'tested_by')).toEqual(['spec:spec/models/order_spec.rb'])
    expect(targets('table:orders', 'touches_table', 'in')).toEqual(['migration:db/migrate/20260101_create_orders.rb'])
    expect(targets('view:app/views/orders/index', 'renders').sort()).toEqual(['partial:app/views/orders/_order', 'partial:app/views/orders/_summary'])
  })

  it('does not invent edges to entities that do not exist', () => {
    expect(graph.neighbors('model:LineItem', { kinds: ['tested_by'] })).toEqual([])
    expect(targets('model:User', 'related', 'in')).toEqual([])
  })
})

describe('runtime precedence and AST rows', () => {
  it('runtime facts win over static ones and keep static-only details', () => {
    const g = buildSemanticGraph(root, {
      runtimeSnapshot: {
        rails: '7.1', ruby: '3.3', environment: 'development', routes: [], middleware: [],
        models: [{
          name: 'Order', table: 'orders', file: '/abs/app/models/order.rb',
          associations: [{ name: 'user', macro: 'belongs_to', class_name: 'User', options: { optional: true } }],
          validations: [{ kind: 'presence', attributes: ['number'], options: {} }], callbacks: [],
        }],
      },
    })
    const order = g.entity('model:Order')!
    expect(order.confidence).toBe('runtime')
    expect(order.line).toBe(1) // static line retained
    expect(g.neighbors('model:Order', { kinds: ['belongs_to'], direction: 'out' })[0].edge).toMatchObject({ confidence: 'runtime', attrs: { optional: true } })
    expect(order.attrs?.scopes).toEqual(['recent'])
  })

  it('adds AST dependency edges only between known classes', () => {
    const g = buildSemanticGraph(root, {
      runtimeSnapshot: null,
      dependencyRows: [
        { from_name: 'CreateOrder', to_name: 'Order', kind: 'call', line: 3, file_path: `${root}/app/services/create_order.rb` },
        { from_name: 'CreateOrder', to_name: 'Unknown', kind: 'call' },
      ],
    })
    const edges = g.neighbors('service:CreateOrder', { kinds: ['calls'], direction: 'out' })
    expect(edges.map(n => n.entity.id)).toEqual(['model:Order'])
    expect(edges[0].edge.line).toBe(3)
  })
})

describe('queries', () => {
  it('forFile finds entities by relative or absolute path', () => {
    expect(graph.forFile('app/models/order.rb').map(e => e.id)).toEqual(['model:Order'])
    expect(graph.forFile(`${root}/app/models/order.rb`).map(e => e.id)).toEqual(['model:Order'])
  })

  it('linkPrompt finds classes, tables and Controller#action shorthands', () => {
    const ids = graph.linkPrompt('Fix the N+1 in orders#index, it loads Order and line_items').map(e => e.id)
    expect(ids).toContain('action:OrdersController#index')
    expect(ids).toContain('model:Order')
    expect(ids).toContain('table:line_items')
    expect(graph.linkPrompt('nothing relevant here')).toEqual([])
  })

  it('neighborhood is depth-limited and capped', () => {
    const one = graph.neighborhood('model:Order', 1).map(e => e.id)
    expect(one[0]).toBe('model:Order')
    expect(one).toContain('model:LineItem')
    expect(graph.neighborhood('model:Order', 3, 3)).toHaveLength(3)
    expect(graph.neighborhood('model:Missing')).toEqual([])
  })

  it('is deterministic and merges duplicates', () => {
    const a = new RailsSemanticGraph().add({ entities: [{ id: 'model:A', kind: 'model', name: 'A', source: 'convention', confidence: 'static' }], edges: [] })
    a.add({ entities: [{ id: 'model:A', kind: 'model', name: 'A', file: 'app/models/a.rb', source: 'source', confidence: 'static', attrs: { x: '1' } }], edges: [] })
    expect(a.entities()).toHaveLength(1)
    expect(a.entity('model:A')).toMatchObject({ source: 'source', file: 'app/models/a.rb' })
  })
})

describe('helpers', () => {
  it('publicMethods stops at private', () => {
    expect(publicMethods('class A\n  def a; end\n  private\n  def b; end\nend\n').map(m => m.name)).toEqual(['a'])
    expect(viewKeyFor('app/views/orders/_form.html.erb')).toEqual({ key: 'app/views/orders/_form', kind: 'partial' })
  })
})

describe('context builder', () => {
  it('renders the model neighbourhood for a file', () => {
    const text = buildSemanticContext(graph, { filePath: 'app/models/order.rb' })
    expect(text).toContain('### Order — model')
    expect(text).toContain('table `orders`: user_id:integer!')
    expect(text).toContain('has_many :line_items → LineItem [dependent')
    expect(text).toContain('foreign key user_id → table:users'.replace('table:', ''))
    expect(text).toContain('specs: spec/models/order_spec.rb')
  })

  it('renders controller actions with their routes and views for a prompt', () => {
    const text = buildSemanticContext(graph, { prompt: 'speed up OrdersController' })
    expect(text).toContain('### OrdersController — controller')
    expect(text).toContain('index ← GET /orders → view app/views/orders/index')
    expect(text).toContain('resource model: Order')
  })

  it('returns an empty string when nothing is referenced, and respects the budget', () => {
    expect(buildSemanticContext(graph, { prompt: 'hello world' })).toBe('')
    const small = buildSemanticContext(graph, { prompt: 'Order User OrdersController', maxChars: 200 })
    expect(small.split('###').length - 1).toBeLessThanOrEqual(2)
  })

  it('overview lists controllers and models', () => {
    const doc = renderGraphOverview(graph)
    expect(doc).toContain('**OrdersController**')
    expect(doc).toContain('**Order**')
    expect(doc).toContain('has_many LineItem')
  })
})
