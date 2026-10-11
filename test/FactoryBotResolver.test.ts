import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { FactoryBotResolver } from '../src/testing/FactoryBotResolver'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

describe('FactoryBotResolver', () => {
  let resolver: FactoryBotResolver
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    resolver = new FactoryBotResolver()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factorybot-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should return null for non-factory-bot calls', () => {
    const mockDoc: any = { lineAt: vi.fn().mockReturnValue({ text: 'user = User.create' }) }
    const result = resolver.provideDefinition(mockDoc, { line: 0, character: 5 })
    expect(result).toBeNull()
  })

  it('should return null when factory not indexed', () => {
    const mockDoc: any = { lineAt: vi.fn().mockReturnValue({ text: 'create(:user)' }) }
    const result = resolver.provideDefinition(mockDoc, { line: 0, character: 5 })
    expect(result).toBeNull()
  })

  it('getAllFactories should return empty initially', () => {
    expect(resolver.getAllFactories()).toEqual([])
  })

  it('getFactory should return undefined for unknown factory', () => {
    expect(resolver.getFactory('unknown')).toBeUndefined()
  })

  it('should index factories from spec/factories directory', () => {
    const specDir = path.join(tmpDir, 'spec', 'factories')
    fs.mkdirSync(specDir, { recursive: true })
    fs.writeFileSync(path.join(specDir, 'users.rb'), [
      'FactoryBot.define do',
      '  factory :user do',
      '    name { "John" }',
      '  end',
      '',
      '  factory :admin, parent: :user do',
      '    role { "admin" }',
      '  end',
      'end',
    ].join('\n'))

    resolver.indexFactories(tmpDir)

    expect(resolver.getAllFactories()).toHaveLength(2)
    expect(resolver.getFactory('user')).toEqual({
      name: 'user',
      filePath: path.join(specDir, 'users.rb'),
      line: 2,
    })
    expect(resolver.getFactory('admin')).toBeDefined()
  })

  it('should index factories from test/factories directory', () => {
    const testDir = path.join(tmpDir, 'test', 'factories')
    fs.mkdirSync(testDir, { recursive: true })
    fs.writeFileSync(path.join(testDir, 'posts.rb'), [
      'FactoryBot.define do',
      '  factory :post do',
      '    title { "Hello" }',
      '  end',
      'end',
    ].join('\n'))

    resolver.indexFactories(tmpDir)

    expect(resolver.getFactory('post')).toBeDefined()
    expect(resolver.getFactory('post')?.line).toBe(2)
  })

  it('should scan subdirectories in factory dirs', () => {
    const subDir = path.join(tmpDir, 'spec', 'factories', 'namespaced')
    fs.mkdirSync(subDir, { recursive: true })
    fs.writeFileSync(path.join(subDir, 'orders.rb'), [
      'FactoryBot.define do',
      '  factory :order do',
      '    total { 100 }',
      '  end',
      'end',
    ].join('\n'))

    resolver.indexFactories(tmpDir)

    expect(resolver.getFactory('order')).toBeDefined()
  })

  it('should clear previous factories when re-indexing', () => {
    const dir = path.join(tmpDir, 'spec', 'factories')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'a.rb'), 'factory :first')

    resolver.indexFactories(tmpDir)
    expect(resolver.getAllFactories()).toHaveLength(1)

    fs.unlinkSync(path.join(dir, 'a.rb'))
    resolver.indexFactories(tmpDir)
    expect(resolver.getAllFactories()).toHaveLength(0)
  })

  it('should provide definition for create()', () => {
    const dir = path.join(tmpDir, 'spec', 'factories')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'users.rb'), 'factory :user')

    resolver.indexFactories(tmpDir)

    const mockDoc: any = { lineAt: vi.fn().mockReturnValue({ text: 'create(:user)' }) }
    const result = resolver.provideDefinition(mockDoc, { line: 0, character: 5 })
    expect(result).not.toBeNull()
  })

  it('should provide definition for build()', () => {
    const dir = path.join(tmpDir, 'spec', 'factories')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'users.rb'), 'factory :user')

    resolver.indexFactories(tmpDir)

    const mockDoc: any = { lineAt: vi.fn().mockReturnValue({ text: '  build(:user)' }) }
    const result = resolver.provideDefinition(mockDoc, { line: 0, character: 5 })
    expect(result).not.toBeNull()
  })

  it('should provide definition for build_stubbed()', () => {
    const dir = path.join(tmpDir, 'spec', 'factories')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'users.rb'), 'factory :user')

    resolver.indexFactories(tmpDir)

    const lineText = 'build_stubbed(:user)'
    const mockDoc: any = { lineAt: vi.fn().mockReturnValue({ text: lineText }) }
    const result = resolver.provideDefinition(mockDoc, { line: 0, character: 5 })
    expect(result).not.toBeNull()
  })

  it('should provide definition for attributes_for()', () => {
    const dir = path.join(tmpDir, 'spec', 'factories')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'users.rb'), 'factory :user')

    resolver.indexFactories(tmpDir)

    const lineText = 'attributes_for(:user)'
    const mockDoc: any = { lineAt: vi.fn().mockReturnValue({ text: lineText }) }
    const result = resolver.provideDefinition(mockDoc, { line: 0, character: 5 })
    expect(result).not.toBeNull()
  })

  it('should skip non-rb files in factory dirs', () => {
    const dir = path.join(tmpDir, 'spec', 'factories')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'readme.md'), '# factories')
    fs.writeFileSync(path.join(dir, 'users.rb'), 'factory :user')

    resolver.indexFactories(tmpDir)

    expect(resolver.getAllFactories()).toHaveLength(1)
  })

  it('should handle empty workspace gracefully', () => {
    resolver.indexFactories(tmpDir)
    expect(resolver.getAllFactories()).toHaveLength(0)
  })
})
