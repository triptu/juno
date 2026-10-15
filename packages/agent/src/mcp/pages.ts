import { Effect, Queue, Stream } from 'effect'
import { AgentCommandError, type OpId, type ReviewRule, type T3Address } from '@juno/agent-contract'
import type { McpManagerApi } from './manager'
import { McpError } from './types'

export function connectionHandlers(manager: McpManagerApi) {
  const command = (opId: OpId, run: () => Promise<void> | void) => Effect.tryPromise({
    try: async () => { await run(); return { opId } },
    // An address the owner typed gets its own reason; nothing else from the server reaches the page.
    catch: (error) => new AgentCommandError({ reason: 'invalid', message: error instanceof McpError && error.reason === 'invalid' ? error.message : 'The connection changed or is unavailable. Refresh and try again.' }),
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
    action: ({ opId, id, action }: { opId: OpId; id: string; action: 'connect' | 'disconnect' | 'enable' | 'disable' | 'refresh' | 'remove' }) => command(opId, async () => {
      switch (action) {
        case 'connect': await manager.authorize(id); return
        case 'disconnect': await manager.disconnect(id); return
        case 'disable': await manager.disconnect(id, false); return
        case 'enable': await manager.connect(id); return
        case 'refresh': await manager.refresh(id); return
        case 'remove': await manager.remove(id); return
      }
    }),
    add: ({ opId, label, url }: { opId: OpId; label: string; url: string }) => command(opId, () => manager.add(label, url)),
    address: ({ opId, address }: { opId: OpId; address: T3Address }) => command(opId, () => manager.address(address.url, address.allowNetwork)),
    tool: ({ opId, id, tool, enabled, review }: { opId: OpId; id: string; tool: string; enabled?: boolean; review?: ReviewRule }) =>
      command(opId, () => manager.setTool(id, tool, { ...(enabled === undefined ? {} : { enabled }), ...(review === undefined ? {} : { review }) })),
    rule: ({ opId, id, review }: { opId: OpId; id: string; review: ReviewRule }) => command(opId, () => manager.setRule(id, review)),
  }
}
