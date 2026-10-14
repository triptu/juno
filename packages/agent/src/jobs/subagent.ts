/**
 * The subagent driver (plan v3 §8). A subagent is depth 1 and has no tools:
 * one request with the pins, the view and its task, on a cheaper model,
 * built by the request builder and stamped on the guard's `subagent` path,
 * so it counts against the same cap. Its answer is the job's one report.
 *
 * It waits while Juno is paused or off. A job the last process left running
 * runs again: the request reads nothing outside Juno, so running it twice
 * costs only its spend.
 */
import type { ProviderGuardApi } from '../providers'
import { providerFailure } from '../providers'
import type { RequestBuilder } from '../request/builder'
import { mode } from '../store/ledger'
import type { Store } from '../store/store'
import type { JobDriver } from './jobs'

export const SUBAGENT_INSTRUCTIONS = [
  "You are a helper of Juno, the owner's assistant. Do the task below and answer with the result only.",
  'Write plain text: no markdown and no emoji. You have no tools and cannot act outside this answer.',
].join('\n')

const failureLine = {
  interrupted: 'was interrupted',
  blocked: 'did not fit in one request, or today\'s budget is used',
  failed: 'got no answer from the model',
} as const

export function subagentDriver(options: {
  readonly store: Store
  readonly guard: ProviderGuardApi
  readonly builder: RequestBuilder
  readonly model: { readonly provider: string; readonly modelId: string }
}): JobDriver {
  const { store, guard, builder } = options
  const waitUntilOn = async (signal: AbortSignal) => {
    while (mode(store) !== 'on' && !signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  return {
    kind: 'subagent',
    resumable: true,
    run: async (job, signal, update) => {
      update({ event: 'progress', state: 'Working on it' })
      await waitUntilOn(signal)
      if (signal.aborted) return { event: 'cancelled' }
      const model = guard.models.getModel(options.model.provider, options.model.modelId)
      if (model === undefined) return { event: 'failed', report: `The task "${job.title}" could not start: its model is not available.` }
      const built = builder.subagent({ task: job.task, system: SUBAGENT_INSTRUCTIONS, model })
      if (built._tag === 'refused') return { event: 'failed', report: `The task "${job.title}" ${failureLine[built.ending._tag === 'blocked' ? 'blocked' : 'interrupted']}.` }
      const message = await guard.models.completeSimple(model, built.context, { sessionId: `juno-job-${job.id}`, signal })
      if (signal.aborted || message.stopReason === 'aborted') return { event: 'cancelled' }
      if (message.stopReason === 'error') {
        const ending = providerFailure(message.errorMessage).ending
        const line = ending._tag === 'blocked' ? failureLine.blocked : ending._tag === 'interrupted' ? failureLine.interrupted : failureLine.failed
        return { event: 'failed', report: `The task "${job.title}" ${line}.` }
      }
      const answer = message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
      return { event: 'done', state: 'Done', report: `The task "${job.title}" finished:\n${answer}` }
    },
  }
}
