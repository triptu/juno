/**
 * Handlers for the send routes (`contract/src/routes/send.ts`). The commands
 * write locally and wake `PostWorker`; `drafts.get` follows the open
 * workspace and never calls Slack.
 */
import { NotSignedIn, SendRoutes } from '@juno/contract'
import { liveQuery, transaction } from '@juno/store'
import { Effect, Stream } from 'effect'
import { Outbox } from '../outbox'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { Workspace } from '../workspace'
import { discardMessage, retryMessage, sendMessage } from './commands'
import { draftKeys, readDraft, writeDraft } from './drafts'
import { PostWorker } from './worker'

export const SendHandlers = SendRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const outbox = yield* Outbox
    const worker = yield* PostWorker
    const provide = <A, E>(effect: Effect.Effect<A, E, Workspace | Outbox>) =>
      effect.pipe(Effect.provideService(Workspace, workspace), Effect.provideService(Outbox, outbox), Effect.tap(() => worker.wake))
    return {
      'messages.send': (payload) => provide(sendMessage(payload)),
      'messages.retry': ({ clientMsgId }) => provide(retryMessage(clientMsgId)),
      'messages.discard': ({ clientMsgId }) => provide(discardMessage(clientMsgId)),
      'drafts.get': ({ topicId }) =>
        serveLiveValue(
          workspace.changes.pipe(
            Stream.switchMap((open) => (open === undefined ? Stream.empty : liveQuery(draftKeys(topicId), timed(readDraft(topicId))).pipe(Stream.provide(open.context)))),
          ),
        ).pipe(retryFirstRun('drafts.get'), Stream.orDie),
      'drafts.set': ({ topicId, text }) =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return yield* new NotSignedIn()
          yield* transaction(writeDraft(topicId, text)).pipe(Effect.provide(open.context), Effect.orDie)
        }),
    }
  }),
)
