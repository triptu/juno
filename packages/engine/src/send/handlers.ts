/**
 * Handlers for the send routes (`contract/src/routes/send.ts`). The commands
 * write locally and wake `PostWorker` and `ActionWorker`; `drafts.get` follows the open
 * workspace and never calls Slack.
 */
import { NotSignedIn, SendRoutes } from '@juno/contract'
import { liveQuery, transaction } from '@juno/store'
import { Effect, Stream } from 'effect'
import { Staging } from '../files/staging'
import { Outbox } from '../outbox'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { Workspace } from '../workspace'
import { ActionWorker } from './actionWorker'
import { deleteMessage, editMessage, reactToMessage } from './actions'
import { discardMessage, retryMessage, sendMessage } from './commands'
import { draftKeys, readDraft, writeDraft } from './drafts'
import { PostWorker } from './worker'

export const SendHandlers = SendRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const outbox = yield* Outbox
    const worker = yield* PostWorker
    const actions = yield* ActionWorker
    const staging = yield* Staging
    const provide = <A, E>(effect: Effect.Effect<A, E, Workspace | Outbox | Staging>) =>
      effect.pipe(
        Effect.provideService(Workspace, workspace),
        Effect.provideService(Outbox, outbox),
        Effect.provideService(Staging, staging),
        Effect.tap(() => Effect.andThen(worker.wake, actions.wake)),
      )
    return {
      'messages.send': (payload) => provide(sendMessage(payload)),
      'messages.retry': ({ clientMsgId }) => provide(retryMessage(clientMsgId)),
      'messages.discard': ({ clientMsgId }) => provide(discardMessage(clientMsgId)),
      'messages.edit': ({ message, text }) => provide(editMessage(message, text)),
      'messages.delete': ({ message }) => provide(deleteMessage(message)),
      'messages.react': ({ message, name, on }) => provide(reactToMessage(message, name, on)),
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
