import { buildRequest, requiredWindow, upper, utf8Bytes, limits } from '@juno/agent-memory'
import type { Api, Model, Tool } from '@earendil-works/pi-ai'
import type { CompactionModel } from '../store/memory'
import type { Store } from '../store/store'
import { COMPACTION_MIN_WINDOW } from './catalog'
import { AdmissionError, readRevision, type ProviderGuardApi } from './guard'

/** WP11 schedules runJob; every summarize attempt reserves independently. No pins. */
export function createCompactionProvider(options: {
  readonly store: Store
  readonly guard: ProviderGuardApi
  readonly model: Model<Api>
  readonly system: string
  readonly tools: readonly Tool[]
  readonly sessionId: string
}): CompactionModel {
  const { guard, model } = options
  const fixed = [options.system, JSON.stringify(options.tools)]
  if (model.contextWindow < Math.max(COMPACTION_MIN_WINDOW, requiredWindow(fixed, 'compaction'))) {
    throw new AdmissionError({ _tag: 'blocked', reason: 'tooLarge' })
  }
  return {
    id: model.id,
    summarize: async task => {
      const instruction = task[0]
      const input = task.at(-1)
      if (task.length < 2 || instruction === undefined || input === undefined || utf8Bytes(instruction) > 2048 ||
        utf8Bytes(input) > limits.input + 2 * limits.framing || upper(task.slice(1, -1)) > limits.context ||
        upper(task) + limits.reserve > requiredWindow([], 'compaction')) {
        throw new AdmissionError({ _tag: 'blocked', reason: 'tooLarge' })
      }
      const revision = readRevision(options.store)
      const request = buildRequest({ ...revision, pins: { revision: revision.pinRev, active: [] },
        lines: [], covered: 0, h: 0, cutoff: 0, tail: [], active: [], parents: [],
        systemAndTools: [...fixed, ...task], contextWindow: model.contextWindow })
      const context = guard.stamp(request, model, {
        systemPrompt: options.system, tools: [...options.tools],
        messages: task.map(content => ({ role: 'user', content, timestamp: 0 })),
      }, 'compaction')
      const message = await guard.models.completeSimple(model, context, { sessionId: options.sessionId })
      if (message.stopReason === 'error' || message.stopReason === 'aborted') throw new Error(message.errorMessage ?? 'Compaction failed')
      if (message.content.some(c => c.type === 'toolCall')) throw new Error('Compaction called a tool')
      return message.content.filter(c => c.type === 'text').map(c => c.text).join('')
    },
  }
}
