import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { RUBY_LANGUAGE_TOOLS } from '../src/mcp/tools/RubyLanguageTools'
import type { ToolContext } from '../src/mcp/tools/ToolContext'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-ruby-mcp-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const context = { workspaceRoot: root } as ToolContext
const tool = (name: string) => {
  const found = RUBY_LANGUAGE_TOOLS.find(candidate => candidate.name === name)
  if (!found) { throw new Error(`Missing tool: ${name}`) }
  return found
}

describe('Ruby language MCP tools', () => {
  it('returns AST symbols with class/module kind, method visibility and source ranges', async () => {
    fs.mkdirSync(path.join(root, 'app', 'services'), { recursive: true })
    fs.writeFileSync(path.join(root, 'app', 'services', 'create_order.rb'), `module Orders
  class CreateOrder
    def call(order_id:)
      Order.find(order_id)
    end

    private

    def audit
      true
    end
  end
end
`)
    const result = JSON.parse(await tool('ruby_get_symbols').handler(context, { file: 'app/services/create_order.rb' }))
    expect(result.types.map((item: { name: string; kind: string }) => [item.name, item.kind])).toEqual([
      ['Orders', 'module'],
      ['Orders::CreateOrder', 'class'],
    ])
    const methods = result.types[1].methods
    expect(methods.find((item: { name: string }) => item.name === 'call')).toMatchObject({
      visibility: 'public',
      params: ['order_id'],
      startLine: 3,
      endLine: 5,
    })
    expect(methods.find((item: { name: string }) => item.name === 'audit').visibility).toBe('private')
  })

  it('returns one method detail and rejects unknown or ambiguous targets', async () => {
    fs.mkdirSync(path.join(root, 'app', 'services'), { recursive: true })
    fs.writeFileSync(path.join(root, 'app', 'services', 'orders.rb'), `class Orders
  def call(order_id:, force: false)
    Order.find(order_id) if force
  end
end
`)
    const result = JSON.parse(await tool('ruby_get_method_details').handler(context, {
      file: 'app/services/orders.rb',
      class_name: 'Orders',
      method_name: 'call',
    }))
    expect(result).toMatchObject({
      className: 'Orders',
      methodName: 'call',
      params: ['order_id', 'force'],
      startLine: 2,
      endLine: 4,
    })
    await expect(tool('ruby_get_method_details').handler(context, {
      file: 'app/services/orders.rb',
      class_name: 'Orders',
      method_name: 'missing',
    })).resolves.toContain('No method')
  })

  it('rejects path traversal and non-Ruby files before reading them', async () => {
    await expect(tool('ruby_get_symbols').handler(context, { file: '../outside.rb' })).resolves.toContain('Refused')
    fs.writeFileSync(path.join(root, 'notes.txt'), 'not ruby')
    await expect(tool('ruby_get_symbols').handler(context, { file: 'notes.txt' })).resolves.toContain('.rb')
  })

  it('checks syntax without executing the Ruby file', async () => {
    fs.mkdirSync(path.join(root, 'app', 'models'), { recursive: true })
    fs.writeFileSync(path.join(root, 'app', 'models', 'valid.rb'), 'class User; end\n')
    fs.writeFileSync(path.join(root, 'app', 'models', 'invalid.rb'), 'class User\n')
    const valid = await tool('ruby_check_syntax').handler(context, { file: 'app/models/valid.rb' })
    const invalid = await tool('ruby_check_syntax').handler(context, { file: 'app/models/invalid.rb' })
    expect(valid).toContain('"status": "ok"')
    expect(invalid).toContain('"status": "error"')
  })

  it('reports declared project capabilities without executing Ruby or Bundler', async () => {
    fs.writeFileSync(path.join(root, '.ruby-version'), '3.3.6\n')
    fs.writeFileSync(path.join(root, 'Gemfile'), "source 'https://rubygems.org'\ngem 'rails'\ngem 'rspec-rails'\n")
    fs.writeFileSync(path.join(root, 'Gemfile.lock'), `GEM
  specs:
    rails (7.2.2)
    rspec-rails (6.1.0)

RUBY VERSION
   ruby 3.3.6p0

BUNDLED WITH
   2.5.22
`)
    fs.mkdirSync(path.join(root, 'spec'), { recursive: true })
    const result = JSON.parse(await tool('ruby_get_project_capabilities').handler(context, {}))
    expect(result).toMatchObject({
      declaredRubyVersion: '3.3.6',
      frameworks: ['rails', 'rspec-rails'],
      testDirectories: ['spec'],
      executionPerformed: false,
    })
  })
})
