import type { Executor } from '../actions/executor'
import type { TurnsOptions } from '../router/open'
import { mcpExecutors } from './actions'
import { createMcpManager, type McpManagerApi } from './manager'
import { MCP_MIGRATIONS } from './schema'
import { mcpTools } from './tools'
import type { Credentials } from './types'

type Wrapped = Pick<TurnsOptions, 'provider' | 'migrations' | 'actions' | 'tools'>

/**
 * Adds the MCP connections to the turn engine's options: the migrations, the
 * manager on the opened store (made where the engine builds its provider),
 * the write executors and the two model tools. `manager()` is the manager once
 * the engine opened its store. The caller starts it after the engine opens,
 * kicks waiting approvals on each change and closes it before the engine.
 */
export function withMcp<T extends Wrapped>(turns: T, credentials: Credentials): { readonly turns: T; readonly manager: () => McpManagerApi | undefined } {
  let manager: McpManagerApi | undefined
  const executors = (): ReadonlyArray<Executor> => {
    const own = turns.actions?.executors
    return [...(typeof own === 'function' ? own() : (own ?? [])), ...(manager ? mcpExecutors(manager) : [])]
  }
  return {
    turns: {
      ...turns,
      migrations: [MCP_MIGRATIONS, ...(turns.migrations ?? [])],
      provider: (store) => {
        manager = createMcpManager({ store, credentials })
        return turns.provider(store)
      },
      actions: { ...turns.actions, executors },
      tools: (context) => [
        ...(turns.tools?.(context) ?? []),
        ...(manager ? mcpTools(manager, { current: context.current, propose: context.actions.propose }) : []),
      ],
    },
    manager: () => manager,
  }
}
