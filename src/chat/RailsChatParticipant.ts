/**
 * RailsChatParticipant - Native VS Code and Cursor Chat Participant for @rails
 *
 * When the AI response contains a unified diff or a full code block that maps
 * to the active file, a 'Apply Changes' button is shown inline so the user can
 * review and apply the diff — the same preview-and-apply flow used by the
 * CodeAction lightbulb's AI fix.
 */

import * as vscode from 'vscode'
import { activeWorkspaceRoot } from '../workspace/activeRoot'
import { RailsAgent } from '../agent/RailsAgent'
import { SchemaIndexer } from '../rails/SchemaIndexer'
import { RoutesIndexer } from '../rails/RoutesIndexer'
import { Logger } from '../util/Logger'
import { extractCodeBlocks, looksLikeDiff } from './ChatDiffApplier'

export class RailsChatParticipant {
  private static instance: RailsChatParticipant | undefined
  private participant?: vscode.ChatParticipant

  static getInstance(): RailsChatParticipant {
    return (RailsChatParticipant.instance ??= new RailsChatParticipant())
  }

  register(
    context: vscode.ExtensionContext,
    agent: RailsAgent,
    schemaIndexer: SchemaIndexer,
    routesIndexer: RoutesIndexer,
  ): void {
    if (typeof vscode.chat?.createChatParticipant !== 'function') {
      Logger.debug('vscode.chat.createChatParticipant is unavailable in this host environment.')
      return
    }

    try {
      this.participant = vscode.chat.createChatParticipant(
        'railsforge.agent',
        async (request, _chatContext, stream) => {
          Logger.info(`[@rails] Chat prompt received: "${request.prompt}" (command: /${request.command ?? 'default'})`)
          await this.handleRequest(request, stream, agent, schemaIndexer, routesIndexer)
        },
      )
      context.subscriptions.push(this.participant)
      Logger.info('Registered @rails chat participant.')
    } catch (err) {
      Logger.warn('Failed to register @rails chat participant:', err)
    }
  }

  private async handleRequest(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    agent: RailsAgent,
    schemaIndexer: SchemaIndexer,
    _routesIndexer: RoutesIndexer,
  ): Promise<void> {
    const command = request.command
    const prompt = request.prompt.trim()
    const editor = vscode.window.activeTextEditor
    const fullText = editor?.document.getText()
    const selection = editor?.document.getText(editor.selection)

    stream.progress('RailsForge AI is analyzing...')

    if (command === 'optimize') {
      stream.markdown('### Analyzing Query Performance & N+1 Risks...\n')
      const tables = schemaIndexer.getAllTables()
      stream.markdown(`- Active Tables Indexed: **${tables.length}**\n`)
      stream.markdown('- Best practice: Use `.includes(:association)` to prevent N+1 queries.\n')
    } else if (command === 'migrate') {
      stream.markdown('### Generating Safe ActiveRecord Migration...\n')
    }

    const result = await agent.run(prompt, {
      fileContent: fullText,
      selection,
      fileName: editor?.document.fileName,
      workspaceRoot: activeWorkspaceRoot(),
    })

    if (result.success) {
      Logger.info('[@rails] Response generated successfully.')
    } else {
      Logger.warn(`[@rails] Response generation failed: ${result.response}`)
    }

    // Stream the response as markdown
    stream.markdown(result.response)

    // --- NEW: Offer to apply changes when the response contains code/diffs ---
    if (result.success && editor) {
      const hasCodeBlocks = extractCodeBlocks(result.response).length > 0
      const hasDiff = looksLikeDiff(result.response)

      if (hasDiff || hasCodeBlocks) {
        stream.button({
          command: 'railsforge.applyChatResponse',
          title: hasDiff ? 'Apply Diff' : 'Apply Changes',
          arguments: [result.response, editor.document.uri.toString(), command ?? 'default', selection ?? ''],
        })
      }
    }
  }
}

// Re-export for type usage in the module
export type { ApplyDiffResult } from './ChatDiffApplier'
