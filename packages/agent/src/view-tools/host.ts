import { Effect } from 'effect'
import { AgentHostError, type HostView, type HostViewChange, type HostViewDraft, type HostViewUndo, type HostPresence } from '@juno/agent-contract'
import type { AccountId } from '@juno/agent-cards'
import { AgentHost } from '../host/client'

export interface ViewHost {
  readonly account: () => typeof AccountId.Type | undefined
  readonly list: (account: typeof AccountId.Type) => Promise<ReadonlyArray<typeof HostView.Type>>
  readonly save: (account: typeof AccountId.Type, view: typeof HostViewDraft.Type, id?: string) => Promise<typeof HostViewChange.Type>
  readonly delete: (account: typeof AccountId.Type, id: string) => Promise<typeof HostViewChange.Type>
  readonly undo: (account: typeof AccountId.Type, undo: typeof HostViewUndo.Type) => Promise<void>
}
export const bindViewHost = (presence: () => typeof HostPresence.Type | undefined) => Effect.gen(function* () {
  const client = yield* AgentHost
  const run = <A, E>(account: typeof AccountId.Type, effect: Effect.Effect<A, E>): Promise<A> => {
    if (presence()?.accountId !== account) return Promise.reject(new AgentHostError({ reason: 'stale', message: 'The Slack account changed.' }))
    return Effect.runPromise(Effect.result(effect)).then((result) => result._tag === 'Success' ? result.success : Promise.reject(result.failure))
  }
  return {
    account: () => presence()?.accountId ?? undefined,
    list: (accountId) => run(accountId, client['host.views.list']({ accountId })),
    save: (accountId, view, id) => run(accountId, id === undefined ? client['host.views.create']({ accountId, view }) : client['host.views.update']({ accountId, id, view })),
    delete: (accountId, id) => run(accountId, client['host.views.delete']({ accountId, id })),
    undo: (accountId, undo) => run(accountId, client['host.views.undo']({ accountId, undo })),
  } satisfies ViewHost
})
