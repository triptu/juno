/** The handlers of `channels.join`, `channels.leave` and `channels.membership` (`contract/src/routes/membership.ts`, `../membership.ts`). */
import { Effect } from 'effect'
import { MembershipRoutes } from '@juno/contract'
import { channelMembership, setMembership } from '../membership'
import { Outbox } from '../outbox'
import { SyncLink } from '../syncLink'
import { Workspace } from '../workspace'

export const MembershipHandlers = MembershipRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const outbox = yield* Outbox
    const link = yield* SyncLink
    const provide = <A, E>(effect: Effect.Effect<A, E, Workspace | Outbox | SyncLink>) =>
      effect.pipe(Effect.provideService(Workspace, workspace), Effect.provideService(Outbox, outbox), Effect.provideService(SyncLink, link))
    return {
      'channels.join': ({ channel }) => provide(setMembership(channel, true)),
      'channels.leave': ({ channel }) => provide(setMembership(channel, false)),
      'channels.membership': ({ channel }) => provide(channelMembership(channel)),
    }
  }),
)
