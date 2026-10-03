import { describe, it, expect } from 'vitest'
import { planChatCommand, composePrompt, ChatCommandInput } from '../src/chat/ChatCommandPlanner'

const base: ChatCommandInput = {
  prompt: 'do it',
  tables: [{ name: 'posts', columns: ['id', 'user_id'] }, { name: 'users', columns: ['id'] }],
  testFramework: 'rspec',
  diagnostics: [],
  patterns: ['service/ProcessOrder', 'query/ActiveUsers'],
}

describe('planChatCommand', () => {
  it('/optimize reports real N+1 candidates from the code', () => {
    const plan = planChatCommand('optimize', { ...base, fileContent: 'Post.all.each do |p|\n  p.user\nend' })
    expect(plan.preface).toContain('N+1 candidates')
    expect(plan.preface).toContain('p.user')
    expect(plan.directive).toContain('CANDIDATES')
  })

  it('/optimize tells the model not to invent N+1 when none are found', () => {
    const plan = planChatCommand('optimize', { ...base, fileContent: 'Post.count' })
    expect(plan.preface).toContain('No N+1 candidates')
    expect(plan.directive).toContain('do NOT invent')
  })

  it('/migrate surfaces strong_migrations hazards for an open migration', () => {
    const code = 'class X < ActiveRecord::Migration[7.1]\n  def change\n    remove_column :users, :name\n  end\nend'
    const plan = planChatCommand('migrate', { ...base, fileContent: code })
    expect(plan.preface).toContain('Migration safety issues')
    expect(plan.directive).toContain('zero-downtime hazards')
  })

  it('/fix includes active diagnostics', () => {
    const plan = planChatCommand('fix', { ...base, diagnostics: [{ line: 4, message: 'Style/Foo' }] })
    expect(plan.preface).toContain('line 4: Style/Foo')
  })

  it('/service lists existing services; /spec follows the detected framework; /scaffold lists tables', () => {
    expect(planChatCommand('service', base).directive).toContain('ProcessOrder')
    expect(planChatCommand('spec', { ...base, testFramework: 'minitest' }).directive).toContain('Minitest')
    expect(planChatCommand('scaffold', base).directive).toContain('posts, users')
  })

  it('/explain is read-only; unknown/no command is a passthrough', () => {
    expect(planChatCommand('explain', base).directive).toContain('READ-ONLY')
    const none = planChatCommand(undefined, base)
    expect(composePrompt(none, 'hi')).toBe('hi')
  })
})
