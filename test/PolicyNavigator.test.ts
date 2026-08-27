import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import { PolicyNavigator } from '../src/rails/PolicyNavigator'

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}))

describe('PolicyNavigator', () => {
  it('should return null when no policy files exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const navigator = new PolicyNavigator()
    const result = navigator.resolvePolicyPath('User', '/workspace')
    expect(result).toBeNull()
  })

  it('should convert CamelCase to underscore for policy file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const navigator = new PolicyNavigator()
    navigator.resolvePolicyPath('AdminUser', '/workspace')
    expect(fs.existsSync).toHaveBeenCalledWith(expect.stringContaining('admin_user_policy.rb'))
  })

  it('should convert multi-word CamelCase correctly', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const navigator = new PolicyNavigator()
    navigator.resolvePolicyPath('SuperAdminUserRole', '/workspace')
    expect(fs.existsSync).toHaveBeenCalledWith(expect.stringContaining('super_admin_user_role_policy.rb'))
  })

  it('should return specific policy file when it exists', () => {
    vi.mocked(fs.existsSync).mockImplementation((path: string) => {
      return path.includes('user_policy.rb')
    })
    const navigator = new PolicyNavigator()
    const result = navigator.resolvePolicyPath('User', '/workspace')
    expect(result).toContain('user_policy.rb')
  })

  it('should fall back to application_policy when specific policy not found', () => {
    vi.mocked(fs.existsSync).mockImplementation((path: string) => {
      return path.includes('application_policy.rb')
    })
    const navigator = new PolicyNavigator()
    const result = navigator.resolvePolicyPath('User', '/workspace')
    expect(result).toContain('application_policy.rb')
  })

  it('should strip @ and : from model name', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const navigator = new PolicyNavigator()
    navigator.resolvePolicyPath('User@Admin', '/workspace')
    expect(fs.existsSync).toHaveBeenCalledWith(expect.stringContaining('user_admin_policy.rb'))
  })

  it('should strip :: from model name', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const navigator = new PolicyNavigator()
    navigator.resolvePolicyPath('Admin::User', '/workspace')
    expect(fs.existsSync).toHaveBeenCalledWith(expect.stringContaining('admin_user_policy.rb'))
  })

  it('should trim whitespace from model name', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const navigator = new PolicyNavigator()
    navigator.resolvePolicyPath('  User  ', '/workspace')
    expect(fs.existsSync).toHaveBeenCalledWith(expect.stringContaining('user_policy.rb'))
  })
})
