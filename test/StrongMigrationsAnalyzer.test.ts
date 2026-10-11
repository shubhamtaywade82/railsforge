import { describe, it, expect } from 'vitest'
import { StrongMigrationsAnalyzer } from '../src/rails/StrongMigrationsAnalyzer'

describe('StrongMigrationsAnalyzer', () => {
  const analyzer = new StrongMigrationsAnalyzer()

  it('detects dangerous add_column with default', () => {
    const migration = `
class AddStatusToOrders < ActiveRecord::Migration[7.1]
  def change
    add_column :orders, :status, :string, default: "pending"
  end
end
`
    const dangers = analyzer.analyzeMigration(migration)
    expect(dangers.length).toBe(1)
    expect(dangers[0].ruleId).toBe('MIG-DEFAULT-001')
    expect(dangers[0].severity).toBe('warning')
  })

  it('detects un-concurrent index additions', () => {
    const migration = `
class AddIndexToUsersEmail < ActiveRecord::Migration[7.1]
  def change
    add_index :users, :email
  end
end
`
    const dangers = analyzer.analyzeMigration(migration)
    expect(dangers.length).toBe(1)
    expect(dangers[0].ruleId).toBe('MIG-INDEX-001')
    expect(dangers[0].severity).toBe('error')
  })

  it('passes safe concurrent index migrations', () => {
    const migration = `
class AddIndexToUsersEmail < ActiveRecord::Migration[7.1]
  disable_ddl_transaction!

  def change
    add_index :users, :email, algorithm: :concurrently
  end
end
`
    const dangers = analyzer.analyzeMigration(migration)
    expect(dangers.length).toBe(0)
  })

  it('detects dangerous remove_column without prior ignore', () => {
    const migration = `
class RemoveStatusFromOrders < ActiveRecord::Migration[7.1]
  def change
    remove_column :orders, :status
  end
end
`
    const dangers = analyzer.analyzeMigration(migration)
    expect(dangers.some(d => d.ruleId === 'MIG-REMOVE-001')).toBe(true)
  })

  it('detects dangerous change_column', () => {
    const migration = `
class ChangeOrdersTotalToString < ActiveRecord::Migration[7.1]
  def change
    change_column :orders, :total, :string
  end
end
`
    const dangers = analyzer.analyzeMigration(migration)
    expect(dangers.some(d => d.ruleId === 'MIG-CHANGE-001')).toBe(true)
  })

  it('detects dangerous rename_column and rename_table', () => {
    const migration = `
class RenameUserToAccount < ActiveRecord::Migration[7.1]
  def change
    rename_column :users, :email, :email_address
    rename_table :users, :accounts
  end
end
`
    const dangers = analyzer.analyzeMigration(migration)
    const renames = dangers.filter(d => d.ruleId === 'MIG-RENAME-001')
    expect(renames.length).toBe(2)
  })
})
