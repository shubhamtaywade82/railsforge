/// <reference types="mocha" />
import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

const EXTENSION_ID = 'ShubhamTaywade.railsforge'

describe('RailsForge AI Chat & Participant in Extension Host', function () {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(ext, `extension ${EXTENSION_ID} not found`)
    if (!ext.isActive) {
      await ext.activate()
    }
  })

  it('declares the @rails chat participant in package.json', () => {
    const root = path.resolve(__dirname, '..', '..', '..')
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      contributes: { chatParticipants: Array<{ id: string; name: string; isSticky: boolean }> }
    }
    const participant = manifest.contributes.chatParticipants?.find(p => p.id === 'railsforge.agent')
    assert.ok(participant, '@rails chat participant missing from package.json')
    assert.strictEqual(participant.name, 'rails')
    assert.strictEqual(participant.isSticky, true)
  })

  it('registers railsforge.applyChatResponse in command registry', async () => {
    const commands = await vscode.commands.getCommands(true)
    assert.ok(commands.includes('railsforge.applyChatResponse'), 'railsforge.applyChatResponse not registered')
  })

  it('focuses the sidebar chat webview via railsforge.chatView.focus', async () => {
    await assert.doesNotReject(
      async () => {
        await vscode.commands.executeCommand('railsforge.chatView.focus')
      },
      'railsforge.chatView.focus should execute without throwing'
    )
  })
})
