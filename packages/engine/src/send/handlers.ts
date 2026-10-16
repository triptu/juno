/**
 * Handlers for the send routes (`contract/src/routes/send.ts`). The commands
 * write locally and wake `PostWorker` and `ActionWorker`; `drafts.get` follows the open
 * workspace and never calls Slack. `messages.precheck` asks the AI provider and `messages.check` reads its answer (`checks.ts`).
 */
import { NotSignedIn, SendRoutes } from '@juno/contract'
import { liveQuery, transaction } from '@juno/store'
import { AiProvider } from '@juno/ai'
import { Clock, Effect, Stream } from 'effect'
import { EngineConfig } from '../config'
import { SyncLink } from '../syncLink'
import { Staging } from '../staging'
import { Outbox } from '../outbox'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { Workspace } from '../workspace'
import { ActionWorker } from './actionWorker'
import { deleteMessage, editMessage, reactToMessage } from './actions'
import { checkMessage, dailyBudget, postcheckMessage, precheckMessage, ROUTE_DAILY_BUDGET } from './checks'
import { discardMessage, retryMessage, sendMessage } from './commands'
import { draftKeys, readDraft, writeDraft } from './drafts'
import { PostWorker } from './worker'

export const SendHandlers = SendRoutes.toLayer(
  Effect.gen(function* () {
    const sync = yield* SyncLink
    const workspace = yield* Workspace
    const outbox = yield* Outbox
    const worker = yield* PostWorker
    const actions = yield* ActionWorker
    const staging = yield* Staging
    const ai = yield* AiProvider
    const config = yield* EngineConfig
    const sent = new Map<string, { text: string; at: number; workspace: unknown }>()
    const routeBudget = dailyBudget(ROUTE_DAILY_BUDGET)
    const provide = <A, E>(effect: Effect.Effect<A, E, Workspace | Outbox | Staging | SyncLink>) =>
      effect.pipe(
        Effect.provideService(Workspace, workspace),
        Effect.provideService(SyncLink, sync),
        Effect.provideService(Outbox, outbox),
        Effect.provideService(Staging, staging),
        Effect.tap(() => Effect.andThen(worker.wake, actions.wake)),
      )
    return {
      'messages.send': (payload) => provide(sendMessage(payload)).pipe(Effect.tap(() => Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis
        for (const [id, entry] of sent) if (at - entry.at >= 1000) sent.delete(id)
        sent.set(payload.clientMsgId, { text: payload.text, at, workspace: yield* workspace.current })
      }))),
      'messages.postcheck': ({ clientMsgId }) => Effect.gen(function* () {
        const entry = sent.get(clientMsgId)
        sent.delete(clientMsgId)
        if (entry === undefined || (yield* Clock.currentTimeMillis) - entry.at >= 1000 || entry.workspace !== (yield* workspace.current)) return {}
        return yield* postcheckMessage(entry.text, clientMsgId)
      }).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(AiProvider, ai), Effect.provideService(EngineConfig, config)),
      'messages.retry': ({ clientMsgId }) => provide(retryMessage(clientMsgId)),
      'messages.discard': ({ clientMsgId }) => provide(discardMessage(clientMsgId)),
      'messages.edit': ({ message, text }) => provide(editMessage(message, text)),
      'messages.delete': ({ message }) => provide(deleteMessage(message)),
      'messages.react': ({ message, name, on }) => provide(reactToMessage(message, name, on)),
      'messages.check': (payload) => checkMessage(payload).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(EngineConfig, config)),
      'messages.precheck': (payload) => precheckMessage(payload, routeBudget).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(AiProvider, ai), Effect.provideService(EngineConfig, config)),
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
