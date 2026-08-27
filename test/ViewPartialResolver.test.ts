import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import { ViewPartialResolver, extractRenderPathAtPosition } from '../src/rails/ViewPartialResolver'

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}))

const mockExistsSync = fs.existsSync as unknown as ReturnType<typeof vi.fn>

describe('extractRenderPathAtPosition', () => {
  it('resolves the path from a plain render call', () => {
    const line = '  <%= render "shared/navbar" %>'
    const char = line.indexOf('shared/navbar') + 3
    expect(extractRenderPathAtPosition(line, char)).toBe('shared/navbar')
  })

  it('resolves the path from a render partial: call with locals', () => {
    const line = '  <%= render partial: "users/card", locals: { user: user } %>'
    const char = line.indexOf('users/card') + 3
    expect(extractRenderPathAtPosition(line, char)).toBe('users/card')
  })

  it('resolves the path from a parenthesized render call', () => {
    const line = '  <%= render(partial: "users/card") %>'
    const char = line.indexOf('users/card') + 3
    expect(extractRenderPathAtPosition(line, char)).toBe('users/card')
  })

  it('returns null when the cursor is outside the render path', () => {
    const line = '  <%= render "shared/navbar" %>'
    expect(extractRenderPathAtPosition(line, 1)).toBeNull()
  })

  it('returns null when the line has no render call', () => {
    const line = '  <p>Just some text</p>'
    expect(extractRenderPathAtPosition(line, 5)).toBeNull()
  })

  it('returns the correct path when multiple render calls are on the same line', () => {
    const line = '  <%= render "sidebar" %><%= render "footer" %>'
    const footerChar = line.indexOf('footer') + 2
    expect(extractRenderPathAtPosition(line, footerChar)).toBe('footer')
  })

  it('returns null when cursor is between two render calls', () => {
    const line = '  <%= render "sidebar" %><%= render "footer" %>'
    const betweenChars = line.indexOf('%>') + 2
    expect(extractRenderPathAtPosition(line, betweenChars)).toBeNull()
  })
})

describe('ViewPartialResolver', () => {
  let resolver: ViewPartialResolver

  beforeEach(() => {
    vi.clearAllMocks()
    resolver = new ViewPartialResolver()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null for empty render path', () => {
    expect(resolver.resolvePartialPath('', '/app/views/users/show.html.erb', '/workspace')).toBeNull()
  })

  it('returns null for whitespace-only render path', () => {
    expect(resolver.resolvePartialPath('   ', '/app/views/users/show.html.erb', '/workspace')).toBeNull()
  })

  it('returns null for quote-only render path', () => {
    expect(resolver.resolvePartialPath('""', '/app/views/users/show.html.erb', '/workspace')).toBeNull()
  })

  it('resolves a simple partial in the same view directory', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/workspace/app/views/users/_card.html.erb')
    const result = resolver.resolvePartialPath('card', '/workspace/app/views/users/show.html.erb', '/workspace')
    expect(result).toBe('/workspace/app/views/users/_card.html.erb')
  })

  it('resolves a namespaced partial path', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/workspace/app/views/shared/_navbar.html.erb')
    const result = resolver.resolvePartialPath('shared/navbar', '/workspace/app/views/users/show.html.erb', '/workspace')
    expect(result).toBe('/workspace/app/views/shared/_navbar.html.erb')
  })

  it('uses workspace views directory when current file is not in app/views', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/workspace/app/views/_form.html.erb')
    const result = resolver.resolvePartialPath('form', '/workspace/app/controllers/users_controller.rb', '/workspace')
    expect(result).toBe('/workspace/app/views/_form.html.erb')
  })

  it('tries all extensions in order', () => {
    // First extension (.html.erb) doesn't exist, second (.erb) does
    mockExistsSync.mockImplementation((p: string) => p === '/workspace/app/views/users/_card.erb')
    const result = resolver.resolvePartialPath('card', '/workspace/app/views/users/show.html.erb', '/workspace')
    expect(result).toBe('/workspace/app/views/users/_card.erb')
  })

  it('tries haml extension', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/workspace/app/views/users/_card.html.haml')
    const result = resolver.resolvePartialPath('card', '/workspace/app/views/users/show.html.erb', '/workspace')
    expect(result).toBe('/workspace/app/views/users/_card.html.haml')
  })

  it('tries slim extension', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/workspace/app/views/users/_card.slim')
    const result = resolver.resolvePartialPath('card', '/workspace/app/views/users/show.html.erb', '/workspace')
    expect(result).toBe('/workspace/app/views/users/_card.slim')
  })

  it('falls back to non-partial filename when no partial found', () => {
    // None of the _card.* files exist, but card.html.erb does
    mockExistsSync.mockImplementation((p: string) => p === '/workspace/app/views/users/card.html.erb')
    const result = resolver.resolvePartialPath('card', '/workspace/app/views/users/show.html.erb', '/workspace')
    expect(result).toBe('/workspace/app/views/users/card.html.erb')
  })

  it('falls back to non-partial for namespaced paths', () => {
    // _navbar doesn't exist in shared/, but navbar.html.erb does
    mockExistsSync.mockImplementation((p: string) => p === '/workspace/app/views/shared/navbar.html.erb')
    const result = resolver.resolvePartialPath('shared/navbar', '/workspace/app/views/users/show.html.erb', '/workspace')
    expect(result).toBe('/workspace/app/views/shared/navbar.html.erb')
  })

  it('returns null when no file exists for any extension', () => {
    mockExistsSync.mockReturnValue(false)
    const result = resolver.resolvePartialPath('nonexistent', '/workspace/app/views/users/show.html.erb', '/workspace')
    expect(result).toBeNull()
  })

  it('strips quotes and colons from render path', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/workspace/app/views/users/_card.html.erb')
    const result = resolver.resolvePartialPath('"card"', '/workspace/app/views/users/show.html.erb', '/workspace')
    expect(result).toBe('/workspace/app/views/users/_card.html.erb')
  })

  it('strips single quotes from render path', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/workspace/app/views/users/_card.html.erb')
    const result = resolver.resolvePartialPath("'card'", '/workspace/app/views/users/show.html.erb', '/workspace')
    expect(result).toBe('/workspace/app/views/users/_card.html.erb')
  })

  it('handles deeply nested partial paths', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/workspace/app/views/admin/dashboard/_stats.html.erb')
    const result = resolver.resolvePartialPath('admin/dashboard/stats', '/workspace/app/views/users/show.html.erb', '/workspace')
    expect(result).toBe('/workspace/app/views/admin/dashboard/_stats.html.erb')
  })
})
