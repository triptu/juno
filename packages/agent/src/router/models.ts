import { createCompactor } from '../compactor/scheduler'
import { createCompactionProvider, type ProviderGuardApi } from '../providers'
import { JUNO_INSTRUCTIONS } from '../request/prompt'
import type { JunoTool } from '../request/tool'
import type { Journal } from '../runtime/journal'
import type { CompactionModel } from '../store/memory'
import type { Store } from '../store/store'
import type { ModelRef, Turns, TurnsOptions } from './open'

export function createTurnModels(store: Store, guard: ProviderGuardApi, initial: { readonly chat: ModelRef; readonly compaction: ModelRef | undefined }, options: TurnsOptions, journal: () => Journal, tools: () => ReadonlyArray<JunoTool>) {
  // The chat model pi runs with (`running`) and the one Settings chose (`wanted`). They meet between runs.
  let wanted = initial.chat
  let running = initial.chat
  const applyModel = async () => {
    if (sameRef(running, wanted)) return
    const next = wanted
    await journal().setModel(next)
    running = next
  }
  // The compaction model: one provider per model, built when first used.
  let compaction = initial.compaction
  const compactionProviders = new Map<string, CompactionModel>()
  const compactionModel = (ref: ModelRef): CompactionModel | undefined => {
    const key = `${ref.provider}/${ref.modelId}`
    const known = compactionProviders.get(key)
    if (known !== undefined) return known
    const model = guard.models.getModel(ref.provider, ref.modelId)
    if (model === undefined) return undefined
    const built = createCompactionProvider({
      store, guard, model, system: JUNO_INSTRUCTIONS, sessionId: 'juno-compaction',
      // Declared, never called: the same tool block as a turn, as plain data (the guard copies the context).
      tools: tools().map(({ registration: { name, description, parameters } }) => ({ name, description, parameters })),
    })
    compactionProviders.set(key, built)
    return built
  }
  return {
    running: () => running,
    apply: applyModel,
    restore: async () => { running = (await journal().model()) ?? running },
    models: () => ({ chat: wanted, compaction }),
    setModels: (next: Parameters<Turns['setModels']>[0]) => {
      if (next.chat !== undefined && guard.models.getModel(next.chat.provider, next.chat.modelId) !== undefined) wanted = next.chat
      if (next.compaction !== undefined) {
        try {
          if (compactionModel(next.compaction) !== undefined) compaction = next.compaction
        } catch (error) {
          // A window below the compaction minimum: keep the model in use.
          options.onReport?.(error)
        }
      }
    },
    compactor: (cutoff: () => number | undefined) => {
      const firstCompaction = compaction === undefined ? undefined : compactionModel(compaction)
      if (firstCompaction !== undefined) {
        const current = () => (compaction === undefined ? undefined : compactionModel(compaction)) ?? firstCompaction
        return createCompactor({
          store, spend: guard.spend, cutoff,
          model: { get id() { return current().id }, summarize: (task) => current().summarize(task) },
          ...(options.onReport ? { onReport: options.onReport } : {}),
        })
      }
    },
  }
}

const sameRef = (a: ModelRef | undefined, b: ModelRef | undefined) => a?.provider === b?.provider && a?.modelId === b?.modelId
