import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { MigrationDiagnostics } from '../src/rails/MigrationDiagnostics'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

describe('MigrationDiagnostics', () => {
  let provider: MigrationDiagnostics

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new MigrationDiagnostics()
  })

  it('should skip non-migration files', () => {
    const doc = new vscode.TextDocument('app/models/user.rb', 'ruby', 'class User; end')
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
  })

  it('should detect add_index without concurrently', () => {
    const code = 'class CreateUsers < ActiveRecord::Migration[7.0]\n  def change\n    add_index :users, :email\n  end\nend'
    const doc = new vscode.TextDocument('/app/db/migrate/20240101_create_users.rb', 'ruby', code)
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
  })

  it('should not flag add_index with algorithm: :concurrently', () => {
    const code = 'class CreateUsers < ActiveRecord::Migration[7.0]\n  def change\n    add_index :users, :email, algorithm: :concurrently\n  end\nend'
    const doc = new vscode.TextDocument('/app/db/migrate/20240101_create_users.rb', 'ruby', code)
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
  })

  it('should detect add_column with default and no null:false', () => {
    const code = 'class AddRoleToUsers < ActiveRecord::Migration[7.0]\n  def change\n    add_column :users, :role, :string, default: "user"\n  end\nend'
    const doc = new vscode.TextDocument('/app/db/migrate/20240102_add_role_to_users.rb', 'ruby', code)
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
  })

  it('should detect remove_column', () => {
    const code = 'class RemoveEmailFromUsers < ActiveRecord::Migration[7.0]\n  def change\n    remove_column :users, :email\n  end\nend'
    const doc = new vscode.TextDocument('/app/db/migrate/20240103_remove_email.rb', 'ruby', code)
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
  })

  it('should detect change_column', () => {
    const code = 'class ChangeEmailType < ActiveRecord::Migration[7.0]\n  def change\n    change_column :users, :email, :text\n  end\nend'
    const doc = new vscode.TextDocument('/app/db/migrate/20240104_change_email_type.rb', 'ruby', code)
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
  })

  it('should detect rename_column', () => {
    const code = 'class RenameEmailToEmailAddress < ActiveRecord::Migration[7.0]\n  def change\n    rename_column :users, :email, :email_address\n  end\nend'
    const doc = new vscode.TextDocument('/app/db/migrate/20240105_rename_column.rb', 'ruby', code)
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
  })

  it('should detect rename_table', () => {
    const code = 'class RenameUsersToAccounts < ActiveRecord::Migration[7.0]\n  def change\n    rename_table :users, :accounts\n  end\nend'
    const doc = new vscode.TextDocument('/app/db/migrate/20240106_rename_table.rb', 'ruby', code)
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
  })

  it('should produce no diagnostics for clean migration', () => {
    const code = 'class CreatePosts < ActiveRecord::Migration[7.0]\n  def change\n    create_table :posts do |t|\n      t.string :title\n      t.text :body\n      t.timestamps\n    end\n  end\nend'
    const doc = new vscode.TextDocument('/app/db/migrate/20240107_create_posts.rb', 'ruby', code)
    provider.updateDiagnostics(doc as unknown as vscode.TextDocument)
  })

  describe('provideCodeActions', () => {
    it('should return concurrently fix and AI fix for MIG-INDEX-001', () => {
      const doc = new vscode.TextDocument('db/migrate/20240101_create_users.rb', 'ruby', '    add_index :users, :email')
      const diag = new vscode.Diagnostic(new vscode.Range(1, 0, 1, 30), 'Adding index without algorithm', 0)
      diag.source = 'StrongMigrations'
      diag.code = 'MIG-INDEX-001'
      const context = new vscode.CodeActionContext([diag])

      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(1, 0, 1, 30),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions.some(a => a.title.includes('AI'))).toBe(true)
      expect(actions.some(a => a.title.includes('algorithm: :concurrently'))).toBe(true)
    })

    it('should return only AI fix for non-INDEX diagnostics', () => {
      const doc = new vscode.TextDocument('db/migrate/20240102_remove.rb', 'ruby', '    remove_column :users, :email')
      const diag = new vscode.Diagnostic(new vscode.Range(1, 0, 1, 30), 'Removing column', 1)
      diag.source = 'StrongMigrations'
      diag.code = 'MIG-REMOVE-001'
      const context = new vscode.CodeActionContext([diag])

      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(1, 0, 1, 30),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions.some(a => a.title.includes('AI'))).toBe(true)
      expect(actions.some(a => a.title.includes('concurrently'))).toBe(false)
    })

    it('should return empty for non-StrongMigrations diagnostics', () => {
      const doc = new vscode.TextDocument('test.rb', 'ruby', '')
      const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 5), 'test', 1)
      diag.source = 'Other'
      const context = new vscode.CodeActionContext([diag])

      const actions = provider.provideCodeActions(
        doc as unknown as vscode.TextDocument,
        new vscode.Range(0, 0, 0, 5),
        context as unknown as vscode.CodeActionContext,
      )
      expect(actions).toEqual([])
    })
  })

  it('should dispose without error', () => {
    expect(() => provider.dispose()).not.toThrow()
  })
})
