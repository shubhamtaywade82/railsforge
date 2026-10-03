import { describe, it, expect } from 'vitest'
import { resolveWorkspaceRoot, isInside } from '../src/workspace/WorkspaceRoots'

describe('resolveWorkspaceRoot', () => {
  const roots = ['/ws/frontend', '/ws/backend', '/ws/backend/engines/billing']

  it('picks the root that owns the file, not the first one', () => {
    expect(resolveWorkspaceRoot('/ws/backend/app/models/user.rb', roots)).toBe('/ws/backend')
  })

  it('prefers the deepest nested root', () => {
    expect(resolveWorkspaceRoot('/ws/backend/engines/billing/app/x.rb', roots)).toBe('/ws/backend/engines/billing')
  })

  it('does not match sibling directories sharing a prefix', () => {
    expect(resolveWorkspaceRoot('/ws/backend-old/x.rb', roots)).toBeUndefined()
    expect(isInside('/ws/backend', '/ws/backend-old/x.rb')).toBe(false)
  })

  it('returns undefined for no file or a file outside every root', () => {
    expect(resolveWorkspaceRoot(undefined, roots)).toBeUndefined()
    expect(resolveWorkspaceRoot('/tmp/x.rb', roots)).toBeUndefined()
  })
})
