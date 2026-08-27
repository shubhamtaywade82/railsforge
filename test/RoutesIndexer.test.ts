import { describe, it, expect } from 'vitest'
import { RoutesIndexer } from '../src/rails/RoutesIndexer'

describe('RoutesIndexer', () => {
  it('parses Rails routes table and resolves named helpers', () => {
    const routesOutput = `
                  Prefix Verb   URI Pattern                   Controller#Action
                    root GET    /                             home#index
                   users GET    /users(.:format)              users#index
                         POST   /users(.:format)              users#create
               edit_user GET    /users/:id/edit(.:format)     users#edit
                    user GET    /users/:id(.:format)          users#show
                         PATCH  /users/:id(.:format)          users#update
                         DELETE /users/:id(.:format)          users#destroy
`
    const indexer = new RoutesIndexer()
    indexer.parseRoutesTable(routesOutput)

    const allRoutes = indexer.getAllRoutes()
    expect(allRoutes.length).toBe(7)

    const usersHelper = indexer.findHelper('users_path')
    expect(usersHelper).toBeDefined()
    expect(usersHelper?.controller).toBe('users')
    expect(usersHelper?.action).toBe('index')

    const editHelper = indexer.findHelper('edit_user_url')
    expect(editHelper).toBeDefined()
    expect(editHelper?.action).toBe('edit')

    const searchResults = indexer.searchRoutes('users')
    expect(searchResults.length).toBe(6)
  })
})

describe('RoutesIndexer DSL parsing', () => {
  it('parses routes.rb DSL with resources, nesting, namespaces and member blocks', () => {
    const indexer = new RoutesIndexer()
    indexer.parseRoutesDsl(`
Rails.application.routes.draw do
  root "articles#index"

  resources :users do
    resources :articles, only: [:index, :show]
  end

  resources :articles do
    resources :comments, only: [:create, :destroy]
    member do
      post :publish
      post :archive
    end
  end

  namespace :admin do
    resources :dashboard, only: [:index]
    resources :users
  end
end
`)

    const routes = indexer.getAllRoutes()
    expect(routes.length).toBe(29)

    const find = (verb: string, uri: string) => routes.find(r => r.verb === verb && r.uriPattern === uri)
    expect(find('GET', '/')).toMatchObject({ controller: 'articles', action: 'index' })
    expect(find('GET', '/users')).toMatchObject({ controller: 'users', action: 'index' })
    expect(find('GET', '/users/:id/edit')).toMatchObject({ controller: 'users', action: 'edit' })
    expect(find('GET', '/users/:user_id/articles')).toMatchObject({ controller: 'articles', action: 'index' })
    expect(find('GET', '/users/:user_id/articles/:id')).toMatchObject({ controller: 'articles', action: 'show' })
    expect(find('POST', '/articles/:id/publish')).toMatchObject({ controller: 'articles', action: 'publish' })
    expect(find('POST', '/articles/:id/archive')).toMatchObject({ controller: 'articles', action: 'archive' })
    expect(find('POST', '/articles/:article_id/comments')).toMatchObject({ controller: 'comments', action: 'create' })
    expect(find('DELETE', '/articles/:article_id/comments/:id')).toMatchObject({ controller: 'comments', action: 'destroy' })
    expect(find('GET', '/admin/users')).toMatchObject({ controller: 'admin/users', action: 'index' })
    expect(find('GET', '/admin/dashboard')).toMatchObject({ controller: 'admin/dashboard', action: 'index' })

    expect(find('GET', '/articles/:article_id/comments')).toBeUndefined()
    expect(find('GET', '/admin/dashboard/:id')).toBeUndefined()
  })

  it('parses namespaced API routes and explicit verb routes', () => {
    const indexer = new RoutesIndexer()
    indexer.parseRoutesDsl(`
Rails.application.routes.draw do
  namespace :api do
    namespace :v1 do
      resources :products do
        member do
          post :restock
        end
      end
      resources :orders, only: [:index, :show, :create]
    end
  end
  get "/health", to: "health#check"
end
`)

    const routes = indexer.getAllRoutes()
    expect(routes.length).toBe(12)

    const find = (verb: string, uri: string) => routes.find(r => r.verb === verb && r.uriPattern === uri)
    expect(find('GET', '/api/v1/products')).toMatchObject({ controller: 'api/v1/products', action: 'index' })
    expect(find('POST', '/api/v1/products/:id/restock')).toMatchObject({ controller: 'api/v1/products', action: 'restock' })
    expect(find('POST', '/api/v1/orders')).toMatchObject({ controller: 'api/v1/orders', action: 'create' })
    expect(find('GET', '/health')).toMatchObject({ controller: 'health', action: 'check' })
    expect(find('DELETE', '/api/v1/orders/:id')).toBeUndefined()
  })

  it('parses singular resources and scope blocks', () => {
    const indexer = new RoutesIndexer()
    indexer.parseRoutesDsl(`
Rails.application.routes.draw do
  resource :profile
  scope "/api", module: :admin do
    get "/stats", to: "reports#index"
  end
end
`)

    const routes = indexer.getAllRoutes()
    expect(routes.length).toBe(7)

    const find = (verb: string, uri: string) => routes.find(r => r.verb === verb && r.uriPattern === uri)
    expect(find('GET', '/profile')).toMatchObject({ controller: 'profiles', action: 'show' })
    expect(find('PATCH', '/profile')).toMatchObject({ controller: 'profiles', action: 'update' })
    expect(find('GET', '/api/stats')).toMatchObject({ controller: 'admin/reports', action: 'index' })
  })

  it('skips route table lines without a controller#action separator', () => {
    const indexer = new RoutesIndexer()
    indexer.parseRoutesTable(`
      Prefix Verb   URI Pattern    Controller#Action
        root GET    /               home#index
             GET    /health        OK
`)
    expect(indexer.getAllRoutes().length).toBe(1)
    expect(indexer.getAllRoutes()[0].controller).toBe('home')
  })

  it('parses singular resource with a do block and pushes to scope stack', () => {
    const indexer = new RoutesIndexer()
    indexer.parseRoutesDsl(`
Rails.application.routes.draw do
  resource :profile do
    get :settings
  end
end
`)
    const routes = indexer.getAllRoutes()
    const find = (verb: string, uri: string) => routes.find(r => r.verb === verb && r.uriPattern === uri)
    expect(find('GET', '/profile/settings')).toMatchObject({ controller: 'profile', action: 'settings' })
  })

  it('singularize leaves non-s-plural words unchanged when nesting under a singular resource', () => {
    const indexer = new RoutesIndexer()
    indexer.parseRoutesDsl(`
Rails.application.routes.draw do
  resource :profile do
    resources :photos, only: [:index]
  end
end
`)
    const routes = indexer.getAllRoutes()
    const find = (verb: string, uri: string) => routes.find(r => r.verb === verb && r.uriPattern === uri)
    expect(find('GET', '/profile/:profile_id/photos')).toMatchObject({ controller: 'photos' })
  })

  it('parses route table lines with fewer than 3 parts', () => {
    const indexer = new RoutesIndexer()
    indexer.parseRoutesTable('\n   \n')
    expect(indexer.getAllRoutes()).toEqual([])
  })

  it('parses singular resources with y-ending names (pluralize to ies)', () => {
    const indexer = new RoutesIndexer()
    indexer.parseRoutesDsl(`
Rails.application.routes.draw do
  resource :category
end
`)
    const routes = indexer.getAllRoutes()
    const find = (verb: string, uri: string) => routes.find(r => r.verb === verb && r.uriPattern === uri)
    expect(find('GET', '/category')).toMatchObject({ controller: 'categories' })
  })

  it('uses collection do block (not member do) for collection actions', () => {
    const indexer = new RoutesIndexer()
    indexer.parseRoutesDsl(`
Rails.application.routes.draw do
  resources :articles do
    collection do
      get :search
    end
  end
end
`)
    const routes = indexer.getAllRoutes()
    const find = (verb: string, uri: string) => routes.find(r => r.verb === verb && r.uriPattern === uri)
    expect(find('GET', '/articles/search')).toMatchObject({ controller: 'articles', action: 'search' })
  })

  it('pluralizes parent name ending in s when nesting under a plural resource', () => {
    const indexer = new RoutesIndexer()
    indexer.parseRoutesDsl(`
Rails.application.routes.draw do
  resources :users do
    resources :posts, only: [:index]
  end
end
`)
    const routes = indexer.getAllRoutes()
    const find = (verb: string, uri: string) => routes.find(r => r.verb === verb && r.uriPattern === uri)
    expect(find('GET', '/users/:user_id/posts')).toMatchObject({ controller: 'posts' })
  })
})