import { describe, it, expect } from 'vitest'
import { validateGeneratorName, parseAttributes, buildGeneratorArgs, parseGeneratorOutput, GENERATORS } from '../src/rails/RailsGenerators'

describe('RailsGenerators', () => {
  it('validates names, allowing namespaces', () => {
    expect(validateGeneratorName('User')).toBeUndefined()
    expect(validateGeneratorName('Admin::User')).toBeUndefined()
    expect(validateGeneratorName('admin/users')).toBeUndefined()
    expect(validateGeneratorName('User; rm -rf /')).toBeDefined()
    expect(validateGeneratorName('--force')).toBeDefined()
    expect(validateGeneratorName('')).toBeDefined()
  })

  it('parses attributes and rejects shell/flag injection', () => {
    expect(parseAttributes('name:string email:string:index user:references{polymorphic}')).toEqual({
      attributes: ['name:string', 'email:string:index', 'user:references{polymorphic}'],
    })
    expect(parseAttributes('')).toEqual({ attributes: [] })
    expect(parseAttributes('name:string --force')).toHaveProperty('error')
    expect(parseAttributes('a;b')).toHaveProperty('error')
  })

  it('builds argv', () => {
    expect(buildGeneratorArgs('generate', 'model', ' User ', ['name:string'], ['--no-test-framework']))
      .toEqual(['generate', 'model', 'User', 'name:string', '--no-test-framework'])
    expect(buildGeneratorArgs('destroy', 'model', 'User', [])).toEqual(['destroy', 'model', 'User'])
  })

  it('parses generator output by status', () => {
    const out = [
      '      invoke  active_record',
      '      create    db/migrate/20260101_create_users.rb',
      '      create    app/models/user.rb',
      '      identical app/models/application_record.rb',
      '       route  resources :users',
      '    conflict  app/models/post.rb',
      '       force  app/models/force.rb',
      '      remove  app/models/old.rb',
    ].join('\n')
    expect(parseGeneratorOutput(out)).toEqual({
      created: ['db/migrate/20260101_create_users.rb', 'app/models/user.rb', 'app/models/force.rb'],
      modified: ['resources :users'],
      removed: ['app/models/old.rb'],
      conflicts: ['app/models/post.rb'],
      skipped: ['app/models/application_record.rb'],
    })
  })

  it('has unique generator ids', () => {
    const ids = GENERATORS.map(g => g.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
