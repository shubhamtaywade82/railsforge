import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'

const EXTENSION_ID = 'ShubhamTaywade.railsforge'

async function until(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise(r => setTimeout(r, 100))
  }
}

async function openFile(folderName: string, relPath: string): Promise<vscode.TextEditor> {
  const folder = vscode.workspace.workspaceFolders?.find(f => path.basename(f.uri.fsPath) === folderName)
  assert.ok(folder, `workspace folder ${folderName} not found`)
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, relPath))
  return vscode.window.showTextDocument(doc)
}

describe('RailsForge MVC Navigation in Extension Host', function () {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(ext, `extension ${EXTENSION_ID} not found`)
    if (!ext.isActive) {
      await ext.activate()
    }
  })

  it('navigates from controller to matching model via railsforge.goToModel', async () => {
    await openFile('rails_a', 'app/controllers/alphas_controller.rb')
    await vscode.commands.executeCommand('railsforge.goToModel')
    await until(() => vscode.window.activeTextEditor?.document.fileName.endsWith(path.join('app', 'models', 'alphas.rb')) ?? false)
    assert.ok(vscode.window.activeTextEditor?.document.fileName.endsWith(path.join('app', 'models', 'alphas.rb')))
  })

  it('navigates from model to matching controller via railsforge.goToController', async () => {
    await openFile('rails_a', 'app/models/alphas.rb')
    await vscode.commands.executeCommand('railsforge.goToController')
    await until(() => vscode.window.activeTextEditor?.document.fileName.endsWith(path.join('app', 'controllers', 'alphas_controller.rb')) ?? false)
    assert.ok(vscode.window.activeTextEditor?.document.fileName.endsWith(path.join('app', 'controllers', 'alphas_controller.rb')))
  })

  it('navigates from controller to view template via railsforge.goToView', async () => {
    await openFile('rails_a', 'app/controllers/alphas_controller.rb')
    await vscode.commands.executeCommand('railsforge.goToView')
    await until(() => vscode.window.activeTextEditor?.document.fileName.endsWith(path.join('app', 'views', 'alphas', 'index.html.erb')) ?? false)
    assert.ok(vscode.window.activeTextEditor?.document.fileName.endsWith(path.join('app', 'views', 'alphas', 'index.html.erb')))
  })

  it('navigates to spec file via railsforge.goToSpec', async () => {
    await openFile('rails_a', 'app/controllers/alphas_controller.rb')
    await vscode.commands.executeCommand('railsforge.goToSpec')
    await until(() => vscode.window.activeTextEditor?.document.fileName.endsWith(path.join('spec', 'models', 'alphas_spec.rb')) ?? false)
    assert.ok(vscode.window.activeTextEditor?.document.fileName.endsWith(path.join('spec', 'models', 'alphas_spec.rb')))
  })
})
