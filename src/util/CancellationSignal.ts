/**
 * CancellationSignal - turns an editor cancellation token into an AbortSignal, so an agent operation can be cancelled
 * the same way whatever started it. The token is described structurally, so this file does not depend on vscode.
 *
 * vscode-free.
 */

export interface CancellationLike {
  readonly isCancellationRequested: boolean
  onCancellationRequested(listener: () => unknown): unknown
}

/** An AbortSignal that aborts when the token is cancelled. A token already cancelled gives an aborted signal. */
export function signalFromCancellation(token: CancellationLike): AbortSignal {
  const controller = new AbortController()
  if (token.isCancellationRequested) {
    controller.abort()
  } else {
    token.onCancellationRequested(() => controller.abort())
  }
  return controller.signal
}
