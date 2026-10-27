/**
 * Handlers for making and editing channels (`contract/src/routes/channels.ts`,
 * SPEC 5 "Channel sheet"). The calls to Slack are in `commands.ts`; what
 * the user may change is read from the store in `rights.ts`.
 */
import { ChannelsRoutes, NotSignedIn } from '@juno/contract'
import { Effect } from 'effect'
import { Workspace } from '../workspace'
import { channelMembers, createChannel, editChannel } from './commands'
import { channelRights } from './rights'

export const ChannelsHandlers = ChannelsRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    return {
      'channels.create': (input) => createChannel(input),
      'channels.edit': (input) => editChannel(input),
      'channels.members': ({ channel }) => channelMembers(channel),
      'channels.rights': ({ channel }) =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return yield* new NotSignedIn()
          // A store failure is a bug, not a state the user can act on (architecture 2.6).
          return yield* channelRights(channel).pipe(Effect.provide(open.context), Effect.orDie)
        }),
    }
  }),
)
