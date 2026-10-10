/**
 * AiChatProvider - wraps `vscode.chat` (chat participants) and `vscode.lm` (language
 * models).
 *
 * VS Code 1.90+ ships native APIs for building AI agents and querying configured
 * language models (Copilot, local Ollama via extensions). RailsForge uses these to
 * power the `@rails` chat participant and to ground AI requests in the Semantic Index.
 *
 * The factories below let the registry plug in the existing RailsChatParticipant and
 * RailsChatViewProvider (already wired in extension.ts) without this file needing to
 * import them directly - keeping the chat-side engine fully decoupled from VS Code
 * adapter concerns.
 */

import * as vscode from 'vscode'
import { SemanticIndex } from './SemanticIndex'
import { PatternCatalogAccess } from './PatternCatalogAccess'

/** Stable participant id - VS Code uses this to persist chat history per-workspace. */
export const RAILSFORGE_CHAT_PARTICIPANT_ID = 'railsforge.agent'

/** Slash commands the @rails participant responds to (also declared in package.json). */
export const RAILSFORGE_CHAT_COMMANDS = [
  'explain', 'refactor', 'extract-service', 'extract-query', 'extract-form',
  'fix-demeter', 'fix-n-plus-1', 'generate-spec', 'review', 'security-scan',
] as const

export type RailsForgeChatCommand = (typeof RAILSFORGE_CHAT_COMMANDS)[number]

/**
 * Chat participant factory. The implementation calls `vscode.chat.createChatParticipant`
 * and returns the participant (which is itself a Disposable).
 */
export interface ChatParticipantFactory {
  (index: SemanticIndex, catalog: PatternCatalogAccess): vscode.ChatParticipant
}

/**
 * Language model selector factory - returns the models the @rails participant is
 * allowed to use, or `undefined` if no model is currently available.
 */
export interface LanguageModelSelectorFactory {
  (): Promise<vscode.LanguageModelChatSelector | undefined>
}

/**
 * Context-grounding factory. Builds the prompt context (active file, selection,
 * semantic index entries) for a ChatRequest. Returns the markdown chunk to inject
 * into the model prompt.
 */
export interface ChatContextGroundingFactory {
  (request: vscode.ChatContext, index: SemanticIndex, catalog: PatternCatalogAccess): Promise<string>
}

/**
 * Wraps `vscode.chat.createChatParticipant`, `vscode.lm.selectChatModels`, and the
 * ChatRequest / ChatContext handling. The participant is created once at activation
 * and disposed when the provider is disposed.
 */
export class AiChatProvider implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []
  private participant: vscode.ChatParticipant | undefined

  constructor(
    private readonly index: SemanticIndex,
    private readonly catalog: PatternCatalogAccess,
    private readonly participantFactory: ChatParticipantFactory,
    private readonly selectorFactory: LanguageModelSelectorFactory,
    private readonly groundingFactory: ChatContextGroundingFactory,
  ) {}

  activate(): void {
    // The participant factory handles `vscode.chat.createChatParticipant` - which
    // requires the `chatParticipants` contribution in package.json to be present at
    // activation time. The registry is responsible for ensuring that contribution
    // exists; if it doesn't, the factory throws and activate() surfaces the error.
    try {
      this.participant = this.participantFactory(this.index, this.catalog)
      this.disposables.push(this.participant)
    } catch (err) {
      // Fail soft - chat is an optional surface. The rest of the extension keeps working.
      console.warn('[RailsForge] AiChatProvider: chat participant registration failed:', err)
    }
  }

  /**
   * Select an available language model for the @rails participant. Returns undefined
   * if no model is configured (the user has Copilot disabled or no Ollama extension).
   */
  async selectModel(): Promise<vscode.LanguageModelChat | undefined> {
    const selector = await this.selectorFactory()
    if (!selector) {
      return undefined
    }
    try {
      const models = await vscode.lm.selectChatModels(selector)
      return models[0]
    } catch (err) {
      console.warn('[RailsForge] AiChatProvider: language model selection failed:', err)
      return undefined
    }
  }

  /**
   * Build the context chunk to inject into the model prompt. Wraps
   * `vscode.chat.ChatContext` inspection and SemanticIndex lookups.
   */
  async buildContextGrounding(request: vscode.ChatContext): Promise<string> {
    return this.groundingFactory(request, this.index, this.catalog)
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables.length = 0
    this.participant = undefined
  }
}
