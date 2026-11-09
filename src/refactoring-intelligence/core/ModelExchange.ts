/**
 * ModelExchange - one validated exchange with the model, with a bounded corrective retry.
 *
 * The model answer is never trusted: `validate` decides whether it is usable. A rejected answer is
 * sent back once with the specific reason (`maxRepairRounds`). A provider failure is not retried; it
 * is reported as-is, because repeating a call that cannot connect only costs time.
 */

import { ADVISOR_SYSTEM_PROMPT, buildRepairSuffix } from './RefactoringPrompts'
import { ADVISOR_LIMITS, AdvisorModel, AdvisorResult } from './types'

export interface ExchangeOptions<T> {
  agent: AdvisorModel
  prompt: string
  validate: (text: string) => AdvisorResult<T> | Promise<AdvisorResult<T>>
  log?: (message: string) => void
}

export async function askWithRepair<T>(options: ExchangeOptions<T>): Promise<AdvisorResult<T>> {
  const { agent, prompt, validate, log } = options
  let current = prompt
  for (let attempt = 0; ; attempt++) {
    const reply = await agent.run(current, { isolated: true, isolatedSystemPrompt: ADVISOR_SYSTEM_PROMPT })
    if (!reply.success) {
      log?.(`refactoring: model call failed: ${firstLine(reply.response)}`)
      return { ok: false, reason: 'model-unavailable', message: reply.response || 'The AI provider did not answer.' }
    }

    const verdict = await validate(reply.response)
    if (verdict.ok) {return verdict}

    log?.(`refactoring: answer rejected on attempt ${attempt + 1} (${verdict.reason}): ${verdict.message}`)
    if (attempt >= ADVISOR_LIMITS.maxRepairRounds) {return verdict}
    current = prompt + buildRepairSuffix(verdict.message, reply.response)
  }
}

export function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trim().slice(0, 300)
}
