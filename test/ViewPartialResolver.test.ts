import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { ViewPartialResolver, extractRenderPathAtPosition } from '../src/rails/ViewPartialResolver'

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}))

const mockExistsSync = fs.existsSync as unknown as ReturnType<typeof vi.fn>

const ROOT = path.resolve(path.sep, 'workspace')
const p = (...segments: string[]) => path.join(ROOT, ...segments)

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
    expect(resolver.resolvePartialPath('', p('app', 'views', 'users', 'show.html.erb'), ROOT)).toBeNull()
  })

  it('returns null for whitespace-only render path', () => {
    expect(resolver.resolvePartialPath('   ', p('app', 'views', 'users', 'show.html.erb'), ROOT)).toBeNull()
  })

  it('returns null for quote-only render path', () => {
    expect(resolver.resolvePartialPath('""', p('app', 'views', 'users', 'show.html.erb'), ROOT)).toBeNull()
  })

  it('resolves a simple partial in the same view directory', () => {
    const expected = p('app', 'views', 'users', '_card.html.erb')
    mockExistsSync.mockImplementation((file: string) => file === expected)
    const result = resolver.resolvePartialPath('card', p('app', 'views', 'users', 'show.html.erb'), ROOT)
    expect(result).toBe(expected)
  })

  it('resolves a namespaced partial path', () => {
    const expected = p('app', 'views', 'shared', '_navbar.html.erb')
    mockExistsSync.mockImplementation((file: string) => file === expected)
    const result = resolver.resolvePartialPath('shared/navbar', p('app', 'views', 'users', 'show.html.erb'), ROOT)
    expect(result).toBe(expected)
  })

  it('uses workspace views directory when current file is not in app/views', () => {
    const expected = p('app', 'views', '_form.html.erb')
    mockExistsSync.mockImplementation((file: string) => file === expected)
    const result = resolver.resolvePartialPath('form', p('app', 'controllers', 'users_controller.rb'), ROOT)
    expect(result).toBe(expected)
  })

  it('tries all extensions in order', () => {
    const expected = p('app', 'views', 'users', '_card.erb')
    mockExistsSync.mockImplementation((file: string) => file === expected)
    const result = resolver.resolvePartialPath('card', p('app', 'views', 'users', 'show.html.erb'), ROOT)
    expect(result).toBe(expected)
  })

  it('tries haml extension', () => {
    const expected = p('app', 'views', 'users', '_card.html.haml')
    mockExistsSync.mockImplementation((file: string) => file === expected)
    const result = resolver.resolvePartialPath('card', p('app', 'views', 'users', 'show.html.erb'), ROOT)
    expect(result).toBe(expected)
  })

  it('tries slim extension', () => {
    const expected = p('app', 'views', 'users', '_card.slim')
    mockExistsSync.mockImplementation((file: string) => file === expected)
    const result = resolver.resolvePartialPath('card', p('app', 'views', 'users', 'show.html.erb'), ROOT)
    expect(result).toBe(expected)
  })

  it('falls back to non-partial filename when no partial found', () => {
    const expected = p('app', 'views', 'users', 'card.html.erb')
    mockExistsSync.mockImplementation((file: string) => file === expected)
    const result = resolver.resolvePartialPath('card', p('app', 'views', 'users', 'show.html.erb'), ROOT)
    expect(result).toBe(expected)
  })

  it('falls back to non-partial for namespaced paths', () => {
    const expected = p('app', 'views', 'shared', 'navbar.html.erb')
    mockExistsSync.mockImplementation((file: string) => file === expected)
    const result = resolver.resolvePartialPath('shared/navbar', p('app', 'views', 'users', 'show.html.erb'), ROOT)
    expect(result).toBe(expected)
  })

  it('returns null when no file exists for any extension', () => {
    mockExistsSync.mockReturnValue(false)
    const result = resolver.resolvePartialPath('nonexistent', p('app', 'views', 'users', 'show.html.erb'), ROOT)
    expect(result).toBeNull()
  })

  it('strips quotes and colons from render path', () => {
    const expected = p('app', 'views', 'users', '_card.html.erb')
    mockExistsSync.mockImplementation((file: string) => file === expected)
    const result = resolver.resolvePartialPath('"card"', p('app', 'views', 'users', 'show.html.erb'), ROOT)
    expect(result).toBe(expected)
  })

  it('strips single quotes from render path', () => {
    const expected = p('app', 'views', 'users', '_card.html.erb')
    mockExistsSync.mockImplementation((file: string) => file === expected)
    const result = resolver.resolvePartialPath("'card'", p('app', 'views', 'users', 'show.html.erb'), ROOT)
    expect(result).toBe(expected)
  })

  it('handles deeply nested partial paths', () => {
    const expected = p('app', 'views', 'admin', 'dashboard', '_stats.html.erb')
    mockExistsSync.mockImplementation((file: string) => file === expected)
    const result = resolver.resolvePartialPath('admin/dashboard/stats', p('app', 'views', 'users', 'show.html.erb'), ROOT)
    expect(result).toBe(expected)
  })
})
