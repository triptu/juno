import { createT3Adapter } from '../t3'
import type { Executor } from '../actions/executor'
import type { TurnsOptions } from '../router/open'
import { mcpExecutors } from './actions'
import { createMcpManager, type McpManagerApi } from './manager'
import { MCP_MIGRATIONS } from './schema'
import { mcpTools } from './tools'
import type { Credentials } from './types'
import type { ReviewModel } from '../review/review'

type Wrapped = Pick<TurnsOptions, 'provider' | 'migrations' | 'actions' | 'tools' | 'jobDrivers' | 'stopExternalJob'>

/**
 * Adds the MCP connections to the turn engine's options: the migrations, the
 * manager on the opened store (made where the engine builds its provider),
 * the write executors and the two model tools, whose calls `review` checks
 * (none: every call that needs a review asks). `manager()` is the manager once
 * the engine opened its store. The caller starts it after the engine opens,
 * kicks waiting approvals on each change and closes it before the engine.
 */
export function withMcp<T extends Wrapped>(turns: T, credentials: Credentials, review?: ReviewModel): { readonly turns: T; readonly manager: () => McpManagerApi | undefined } {
  let manager: McpManagerApi | undefined
  let t3: ReturnType<typeof createT3Adapter> | undefined
  const executors = (): ReadonlyArray<Executor> => {
    const own = turns.actions?.executors
    return [...(typeof own === 'function' ? own() : (own ?? [])), ...(manager ? mcpExecutors(manager) : []), ...(t3?.executors ?? [])]
  }
  return {
    turns: {
      ...turns,
      migrations: [MCP_MIGRATIONS, ...(turns.migrations ?? [])],
      provider: (store) => {
        manager = createMcpManager({ store, credentials })
        t3 = createT3Adapter(manager)
        return turns.provider(store)
      },
      actions: { ...turns.actions, executors },
      stopExternalJob: async (job, click) => job.kind === 't3' ? (t3?.stop(job, click) ?? false) : (turns.stopExternalJob?.(job, click) ?? false),
      jobDrivers: () => [...(turns.jobDrivers?.() ?? []), ...(t3 ? [t3.driver] : [])],
      tools: (context) => [
        ...(turns.tools?.(context) ?? []),
        ...(t3?.tools(context) ?? []),
        ...(manager ? mcpTools(manager, { current: context.current, actions: context.actions, ...(review ? { review } : {}) }) : []),
      ],
    },
    manager: () => manager,
  }
}
