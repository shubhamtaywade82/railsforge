/**
 * VsCodeLmRequest - one request to the editor's language model. The model is chosen by the caller, so the request and its
 * cancellation can be tested with a fake model.
 *
 * The request is cancelled, through the model's cancellation token, when the operation is cancelled, when the timeout
 * passes, or when the operation was already cancelled. A cancelled request never returns its partial text as an answer:
 * if the stream ends after the token was cancelled, the request throws.
 */

import * as vscode from 'vscode'

export interface VsCodeLmDeps {
  /** Picks a chat model, or undefined when none is available. The family is the user's setting, which may be empty. */
  selectModel(family: string): Promise<Pick<vscode.LanguageModelChat, 'sendRequest'> | undefined>
}

export async function requestViaVsCodeLm(
  deps: VsCodeLmDeps,
  system: string,
  prompt: string,
  family: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const model = await deps.selectModel(family)
  if (!model) {
    throw new Error(family
      ? `No VS Code language model matches family "${family}". Install/sign in to a model provider or change railsForge.ai.vscodeLm.family.`
      : 'No VS Code language model is available. Sign in to Copilot or install a Language Model provider extension.')
  }
  const source = new vscode.CancellationTokenSource()
  const timer = setTimeout(() => source.cancel(), timeoutMs)
  const onAbort = (): void => source.cancel()
  if (signal?.aborted) {source.cancel()} else {signal?.addEventListener('abort', onAbort, { once: true })}
  try {
    // The Language Model API has no system role: fold the system prompt into the first user message.
    const messages = [vscode.LanguageModelChatMessage.User(`${system}\n\n---\n\n${prompt}`)]
    const response = await model.sendRequest(messages, { justification: 'RailsForge needs a model to answer your Rails question.' }, source.token)
    let text = ''
    for await (const chunk of response.text) {
      text += chunk
    }
    if (source.token.isCancellationRequested) {throw new Error('The model request was cancelled.')}
    return text
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    source.dispose()
  }
}
