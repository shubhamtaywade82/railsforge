import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { RAILSFORGE_TOOLS } from '../src/mcp/tools/definitions'
import { ToolContext } from '../src/mcp/tools/ToolContext'
import { writeRailsFixture } from './support/railsFixture'

const root = writeRailsFixture()
const ctx = new ToolContext(root)
const tool = (name: string) => RAILSFORGE_TOOLS.find(t => t.name === name)!
const run = (name: string, input: Record<string, unknown>): Promise<string> => tool(name).handler(ctx, input)

describe('Ruby MCP tools', () => {
  describe('ruby_get_symbols', () => {
    it('extracts classes, superclasses, and methods from a ruby file', async () => {
      const sampleFile = path.join(root, 'app', 'models', 'user.rb')
      fs.mkdirSync(path.dirname(sampleFile), { recursive: true })
      fs.writeFileSync(
        sampleFile,
        'class User < ApplicationRecord\n  include Authenticatable\n  def full_name(prefix = nil)\n    "#{prefix} #{name}"\n  end\nend\n',
      )

      const result = JSON.parse(await run('ruby_get_symbols', { path: 'app/models/user.rb' })) as {
        filePath: string
        types: Array<{ name: string; superclass?: string; includes: string[]; methods: Array<{ name: string; params: string[] }> }>
      }

      expect(result.filePath).toBe('app/models/user.rb')
      expect(result.types).toHaveLength(1)
      expect(result.types[0].name).toBe('User')
      expect(result.types[0].superclass).toBe('ApplicationRecord')
      expect(result.types[0].includes).toContain('Authenticatable')
      expect(result.types[0].methods[0].name).toBe('full_name')
      expect(result.types[0].methods[0].params).toEqual(['prefix'])
    })

    it('rejects path traversal outside workspace root', async () => {
      const result = JSON.parse(await run('ruby_get_symbols', { path: '../../etc/passwd' })) as { error: string }
      expect(result.error).toContain('Invalid path')
    })

    it('returns error when file does not exist', async () => {
      const result = JSON.parse(await run('ruby_get_symbols', { path: 'app/models/ghost.rb' })) as { error: string }
      expect(result.error).toContain('File not found')
    })
  })

  describe('ruby_get_method_details', () => {
    it('returns parameters, line range, and internal calls for a method', async () => {
      const sampleFile = path.join(root, 'app', 'services', 'order_processor.rb')
      fs.mkdirSync(path.dirname(sampleFile), { recursive: true })
      fs.writeFileSync(
        sampleFile,
        'class OrderProcessor\n  def process(order)\n    validate(order)\n    order.charge!\n  end\n  private\n  def validate(order)\n  end\nend\n',
      )

      const res = JSON.parse(await run('ruby_get_method_details', {
        path: 'app/services/order_processor.rb',
        method_name: 'process',
      })) as {
        className: string
        method: { name: string; isPublic: boolean; params: string[]; calls: Array<{ method: string }> }
      }

      expect(res.className).toBe('OrderProcessor')
      expect(res.method.name).toBe('process')
      expect(res.method.isPublic).toBe(true)
      expect(res.method.params).toEqual(['order'])
      const called = res.method.calls.map(c => c.method)
      expect(called).toContain('validate')
      expect(called).toContain('charge!')
    })

    it('disambiguates when class_name is specified', async () => {
      const sampleFile = path.join(root, 'app', 'models', 'multi.rb')
      fs.writeFileSync(
        sampleFile,
        'class Alpha\n  def run; end\nend\nclass Beta\n  def run; end\nend\n',
      )

      const res = JSON.parse(await run('ruby_get_method_details', {
        path: 'app/models/multi.rb',
        method_name: 'run',
        class_name: 'Beta',
      })) as { className: string }

      expect(res.className).toBe('Beta')
    })

    it('returns error when method does not exist', async () => {
      const res = JSON.parse(await run('ruby_get_method_details', {
        path: 'app/models/multi.rb',
        method_name: 'missing_method',
      })) as { error: string }

      expect(res.error).toContain('No enclosing type found')
    })
  })

  describe('ruby_check_syntax', () => {
    it('reports valid syntax for correct Ruby snippet', async () => {
      const res = JSON.parse(await run('ruby_check_syntax', {
        code: 'def valid_method(x)\n  x + 1\nend\n',
      })) as { valid: boolean; status: string }

      expect(res.valid).toBe(true)
      expect(res.status).toBe('ok')
    })

    it('reports syntax error with line details for invalid Ruby snippet', async () => {
      const res = JSON.parse(await run('ruby_check_syntax', {
        code: 'def unclosed_block\n  x = 1',
      })) as { valid: boolean; status: string; message?: string }

      expect(res.valid).toBe(false)
      expect(res.status).toBe('error')
      expect(res.message).toBeDefined()
    })
  })

  describe('ruby_get_project_capabilities', () => {
    it('detects Ruby, Rails, linters, and type checkers from project files', async () => {
      fs.writeFileSync(path.join(root, '.ruby-version'), '3.3.4\n')
      fs.writeFileSync(path.join(root, '.rubocop.yml'), 'AllCops:\n  NewCops: enable\n')
      fs.mkdirSync(path.join(root, 'sig'), { recursive: true })

      const res = JSON.parse(await run('ruby_get_project_capabilities', {})) as {
        rubyVersion: string
        linters: { rubocop: boolean; standard: boolean }
        typeCheckers: { steep: boolean; sorbet: boolean; rbs: boolean }
      }

      expect(res.rubyVersion).toBe('3.3.4')
      expect(res.linters.rubocop).toBe(true)
      expect(res.linters.standard).toBe(false)
      expect(res.typeCheckers.rbs).toBe(true)
      expect(res.typeCheckers.sorbet).toBe(false)
    })
  })
})
