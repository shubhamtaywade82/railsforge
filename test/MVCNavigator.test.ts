import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { MVCNavigator } from '../src/rails/MVCNavigator'

// Companion paths are built with path.join, so expectations use the platform separator.
const native = (p: string) => p.split('/').join(path.sep)

describe('MVCNavigator', () => {
  const mvc = new MVCNavigator()
  const root = '/path/to/my_app'

  it('identifies file types from path', () => {
    expect(mvc.identifyFileType('/path/to/my_app/app/models/user.rb')).toBe('model')
    expect(mvc.identifyFileType('/path/to/my_app/app/controllers/users_controller.rb')).toBe('controller')
    expect(mvc.identifyFileType('/path/to/my_app/app/views/users/index.html.erb')).toBe('view')
    expect(mvc.identifyFileType('/path/to/my_app/spec/models/user_spec.rb')).toBe('spec')
  })

  it('calculates companion paths for a model', () => {
    const paths = mvc.getCompanionPaths('/path/to/my_app/app/models/user.rb', root)
    expect(paths.model).toBe(native('/path/to/my_app/app/models/user.rb'))
    expect(paths.controller).toBe(native('/path/to/my_app/app/controllers/users_controller.rb'))
    expect(paths.viewDir).toBe(native('/path/to/my_app/app/views/users'))
    expect(paths.spec).toBe(native('/path/to/my_app/spec/models/user_spec.rb'))
  })

  it('calculates companion paths for a controller', () => {
    const paths = mvc.getCompanionPaths('/path/to/my_app/app/controllers/orders_controller.rb', root)
    expect(paths.model).toBe(native('/path/to/my_app/app/models/order.rb'))
    expect(paths.controller).toBe(native('/path/to/my_app/app/controllers/orders_controller.rb'))
  })
})
