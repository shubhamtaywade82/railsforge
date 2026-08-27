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

  it('identifies migration files and returns unknown for unrecognized paths', () => {
    expect(mvc.identifyFileType('/path/to/my_app/db/migrate/20240101000000_create_users.rb')).toBe('migration')
    expect(mvc.identifyFileType('/path/to/my_app/lib/something.rb')).toBe('unknown')
  })

  it('pluralizes model names ending in consonant+y to ies for companion paths', () => {
    const paths = mvc.getCompanionPaths('/path/to/my_app/app/models/category.rb', root)
    expect(paths.controller).toBe('/path/to/my_app/app/controllers/categories_controller.rb')
    expect(paths.viewDir).toBe('/path/to/my_app/app/views/categories')
  })

  it('identifies helper, service, serializer, and policy files', () => {
    expect(mvc.identifyFileType('/path/to/my_app/app/helpers/application_helper.rb')).toBe('helper')
    expect(mvc.identifyFileType('/path/to/my_app/app/services/billing_service.rb')).toBe('service')
    expect(mvc.identifyFileType('/path/to/my_app/app/serializers/user_serializer.rb')).toBe('serializer')
    expect(mvc.identifyFileType('/path/to/my_app/app/policies/user_policy.rb')).toBe('policy')
  })

  it('extracts resource info for helper, service, serializer, and policy files', () => {
    const helperInfo = mvc.extractResourceInfo('/app/helpers/users_helper.rb')
    expect(helperInfo).not.toBeNull()
    expect(helperInfo!.type).toBe('helper')
    expect(helperInfo!.singularName).toBe('user')

    const serviceInfo = mvc.extractResourceInfo('/app/services/invoice_service.rb')
    expect(serviceInfo).not.toBeNull()
    expect(serviceInfo!.type).toBe('service')
    expect(serviceInfo!.singularName).toBe('invoice')

    const serializerInfo = mvc.extractResourceInfo('/app/serializers/user_serializer.rb')
    expect(serializerInfo).not.toBeNull()
    expect(serializerInfo!.type).toBe('serializer')
    expect(serializerInfo!.singularName).toBe('user')

    const policyInfo = mvc.extractResourceInfo('/app/policies/post_policy.rb')
    expect(policyInfo).not.toBeNull()
    expect(policyInfo!.type).toBe('policy')
    expect(policyInfo!.singularName).toBe('post')
  })

  it('calculates companion paths for a helper file', () => {
    const paths = mvc.getCompanionPaths('/path/to/my_app/app/helpers/orders_helper.rb', root)
    expect(paths.model).toBe('/path/to/my_app/app/models/order.rb')
    expect(paths.helper).toBe('/path/to/my_app/app/helpers/orders_helper.rb')
  })

  it('calculates companion paths for a service file', () => {
    const paths = mvc.getCompanionPaths('/path/to/my_app/app/services/payment_service.rb', root)
    expect(paths.model).toBe('/path/to/my_app/app/models/payment.rb')
    expect(paths.service).toBe('/path/to/my_app/app/services/payment_service.rb')
  })

  it('extracts resource info for spec and test files', () => {
    const specInfo = mvc.extractResourceInfo('/spec/models/user_spec.rb')
    expect(specInfo).not.toBeNull()
    expect(specInfo!.type).toBe('spec')
    expect(specInfo!.singularName).toBe('user')

    const testInfo = mvc.extractResourceInfo('/test/models/user_test.rb')
    expect(testInfo).not.toBeNull()
    expect(testInfo!.type).toBe('spec')
    expect(testInfo!.singularName).toBe('user')
  })

  it('returns null for unknown file types', () => {
    expect(mvc.extractResourceInfo('/lib/something.rb')).toBeNull()
    expect(mvc.extractResourceInfo('/app/jobs/my_job.rb')).toBeNull()
  })

  it('handles Windows-style paths', () => {
    expect(mvc.identifyFileType('C:\\Users\\project\\app\\models\\user.rb')).toBe('model')
  })

  it('singularizes names ending in ies', () => {
    const paths = mvc.getCompanionPaths('/path/to/my_app/app/models/country.rb', root)
    expect(paths.controller).toBe('/path/to/my_app/app/controllers/countries_controller.rb')
  })
})
