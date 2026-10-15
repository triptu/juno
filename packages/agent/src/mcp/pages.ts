import { Effect, Queue, Stream } from 'effect'
import { AgentCommandError, type OpId } from '@juno/agent-contract'
import type { McpManagerApi } from './manager'

export function connectionHandlers(manager: McpManagerApi) {
  const command = (opId: OpId, run: () => Promise<void> | void) => Effect.tryPromise({
    try: async () => { await run(); return { opId } },
    catch: () => new AgentCommandError({ reason: 'invalid', message: 'The connection changed or is unavailable. Refresh and try again.' }),
  })
  return {
    page: () => Stream.callback<ReturnType<McpManagerApi['page']>>((queue) => Effect.acquireRelease(
      Effect.sync(() => {
        const emit = () => { Queue.offerUnsafe(queue, manager.page()) }
        const unsubscribe = manager.subscribe(emit)
        emit()
        return unsubscribe
      }),
      (unsubscribe) => Effect.sync(unsubscribe),
    )),
    action: ({ opId, id, action }: { opId: OpId; id: string; action: 'connect' | 'disconnect' | 'enable' | 'disable' | 'refresh' }) => command(opId, async () => {
      switch (action) {
        case 'connect': await manager.authorize(id); return
        case 'disconnect': await manager.disconnect(id); return
        case 'disable': await manager.disconnect(id, false); return
        case 'enable': await manager.connect(id); return
        case 'refresh': await manager.refresh(id); return
      }
    }),
    tier: ({ opId, id, tool, schemaHash, tier }: { opId: OpId; id: string; tool: string; schemaHash: string; tier: 0 | 3 }) =>
      command(opId, () => manager.setTier(id, tool, schemaHash, tier)),
  }
}
