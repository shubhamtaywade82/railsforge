import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { ViewComponentResolver } from '../src/rails/ViewComponentResolver'

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}))

describe('ViewComponentResolver', () => {
  it('should return null when component class file does not exist', () => {
    const resolver = new ViewComponentResolver()
    const result = resolver.resolveComponent('UserProfile', '/workspace')
    expect(result).toBeNull()
  })

  it('should resolve component without template', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: string) => {
      return p.includes('user_profile_component.rb') && p.endsWith('.rb') && !p.includes('.erb')
    })
    const resolver = new ViewComponentResolver()
    const result = resolver.resolveComponent('UserProfile', '/workspace')
    expect(result).not.toBeNull()
    expect(result!.templateFile).toBeUndefined()
    expect(result!.classFile).toContain('user_profile_component.rb')
  })

  it('should resolve component with template', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: string) => {
      return p.includes('user_profile_component')
    })
    const resolver = new ViewComponentResolver()
    const result = resolver.resolveComponent('UserProfileComponent', '/workspace')
    expect(result).not.toBeNull()
    expect(result!.templateFile).toContain('.erb')
  })

  it('should strip Component suffix from name', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: string) => {
      return p.includes('user_profile_component.rb')
    })
    const resolver = new ViewComponentResolver()
    const result = resolver.resolveComponent('UserProfileComponent', '/workspace')
    expect(result).not.toBeNull()
  })
})
