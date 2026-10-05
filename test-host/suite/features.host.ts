/// <reference types="mocha" />
import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

const EXTENSION_ID = 'ShubhamTaywade.railsforge'

async function openFixtureFile(folderName: string, relPath: string): Promise<vscode.TextEditor> {
  const folder = vscode.workspace.workspaceFolders?.find(f => path.basename(f.uri.fsPath) === folderName)
  assert.ok(folder, `workspace folder ${folderName} not found`)
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, relPath))
  return vscode.window.showTextDocument(doc)
}

describe('RailsForge Features End-to-End in Extension Host', function () {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(ext, `extension ${EXTENSION_ID} not found`)
    if (!ext.isActive) {
      await ext.activate()
    }
  })

  after(() => {
    const folder = vscode.workspace.workspaceFolders?.find(f => path.basename(f.uri.fsPath) === 'rails_a')
    if (folder) {
      const cursorDir = path.join(folder.uri.fsPath, '.cursor')
      if (fs.existsSync(cursorDir)) {
        // Best-effort cleanup after the assertions have run. On Windows the VS Code file watcher can
        // still hold the freshly written directory open, so retry on EPERM/EBUSY instead of failing
        // an otherwise green suite.
        try {
          fs.rmSync(cursorDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
        } catch (err) {
          console.warn(`could not remove ${cursorDir}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  })

  it('scans workspace architecture via railsforge.scanWorkspaceArchitecture', async () => {
    await assert.doesNotReject(
      async () => {
        await vscode.commands.executeCommand('railsforge.scanWorkspaceArchitecture')
      },
      'scanWorkspaceArchitecture should execute without throwing'
    )
  })

  it('analyzes migration safety via railsforge.analyzeMigration on active migration', async () => {
    await openFixtureFile('rails_a', 'db/migrate/20261004120000_create_alphas.rb')
    await assert.doesNotReject(
      async () => {
        await vscode.commands.executeCommand('railsforge.analyzeMigration')
      },
      'analyzeMigration should execute on valid migration'
    )
  })

  it('exports cursor rules to the workspace via railsforge.exportCursorRules', async () => {
    const folder = vscode.workspace.workspaceFolders?.find(f => path.basename(f.uri.fsPath) === 'rails_a')
    assert.ok(folder, 'rails_a folder not found')
    await openFixtureFile('rails_a', 'app/models/alphas.rb')
    await vscode.commands.executeCommand('railsforge.exportCursorRules')
    const rulePath = path.join(folder.uri.fsPath, '.cursor', 'rules', 'railsforge.mdc')
    assert.ok(fs.existsSync(rulePath), `.cursor/rules/railsforge.mdc should be created at ${rulePath}`)
  })

  it('populates pattern catalog and architecture commands cleanly', async () => {
    const commands = await vscode.commands.getCommands(true)
    assert.ok(commands.includes('railsforge.searchRoutes'))
    assert.ok(commands.includes('railsforge.refactorSelection'))
    assert.ok(commands.includes('railsforge.extractService'))
    assert.ok(commands.includes('railsforge.extractQuery'))
  })
})
