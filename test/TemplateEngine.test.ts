import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, it, expect, afterEach } from 'vitest'
import { renderTemplate, findCustomTemplate } from '../src/generators/TemplateEngine'

describe('renderTemplate', () => {
  it('substitutes every {{variable}} occurrence', () => {
    expect(renderTemplate('class {{class_name}} < {{base_class}}', { class_name: 'Foo', base_class: 'Bar' })).toBe('class Foo < Bar')
  })

  it('leaves an unmatched {{variable}} as-is instead of dropping it', () => {
    expect(renderTemplate('{{known}} and {{unknown}}', { known: 'X' })).toBe('X and {{unknown}}')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{ class_name }}', { class_name: 'Foo' })).toBe('Foo')
  })

  it('substitutes the same variable at every occurrence', () => {
    expect(renderTemplate('{{x}}-{{x}}-{{x}}', { x: 'y' })).toBe('y-y-y')
  })
})

describe('findCustomTemplate', () => {
  let tmpRoot: string

  afterEach(() => {
    if (tmpRoot) {fs.rmSync(tmpRoot, { recursive: true, force: true })}
  })

  it('returns null when .railsforge/templates/ does not exist', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-tmpl-'))
    expect(findCustomTemplate(tmpRoot, 'service')).toBeNull()
  })

  it('reads a template that exists', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-tmpl-'))
    fs.mkdirSync(path.join(tmpRoot, '.railsforge', 'templates'), { recursive: true })
    fs.writeFileSync(path.join(tmpRoot, '.railsforge', 'templates', 'service.erb'), 'class {{class_name}}\nend\n')
    expect(findCustomTemplate(tmpRoot, 'service')).toBe('class {{class_name}}\nend\n')
  })

  it('returns null for a different template name that does not exist', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-tmpl-'))
    fs.mkdirSync(path.join(tmpRoot, '.railsforge', 'templates'), { recursive: true })
    fs.writeFileSync(path.join(tmpRoot, '.railsforge', 'templates', 'service.erb'), 'x')
    expect(findCustomTemplate(tmpRoot, 'query')).toBeNull()
  })

  it('returns null when the template path exists but cannot be read as a file', () => {
    // A directory at the template path exists but cannot be read as a file, on every platform and for every user.
    // The earlier version made the file unreadable with chmod 000, which root ignores, so it failed when run as root.
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-tmpl-'))
    fs.mkdirSync(path.join(tmpRoot, '.railsforge', 'templates', 'service.erb'), { recursive: true })
    expect(findCustomTemplate(tmpRoot, 'service')).toBeNull()
  })
})
