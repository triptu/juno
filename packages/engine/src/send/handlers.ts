/**
 * Handlers for the send routes (`contract/src/routes/send.ts`). The commands
 * write locally and wake `PostWorker` and `ActionWorker`; `drafts.get` follows the open
 * workspace and never calls Slack, and `drafts.set` hands the draft to `DraftSync`, which keeps it in step
 * with Slack's. `messages.precheck` asks the route model; `messages.check` reads its answer.
 * `messages.postcheck` and `messages.grammar` check a sent message afterwards (`checks.ts`, `grammar.ts`).
 * `messages.attachmentAction` sends a button press straight to Slack (`buttons.ts`).
 */
import { decodeDraft, NotSignedIn, SendRoutes } from '@juno/contract'
import { liveQuery } from '@juno/store'
import { AiProvider } from '@juno/ai'
import { Clock, Effect, Stream } from 'effect'
import { EngineConfig } from '../config'
import { SessionClient } from '../sessionClient'
import { SyncLink } from '../syncLink'
import { Staging } from '../staging'
import { Outbox } from '../outbox'
import { retryFirstRun, serveLiveValue, timed } from '../protocol/live'
import { Workspace } from '../workspace'
import { ActionWorker } from './actionWorker'
import { broadcastMessage, deleteMessage, editMessage, reactToMessage, resolveMessageAction } from './actions'
import { pressButton } from './buttons'
import { checkMessage, dailyBudget, grammarForSent, postcheckMessage, precheckMessage, ROUTE_DAILY_BUDGET } from './checks'
import { grammarChecks } from './grammar'
import { discardMessage, retryMessage, sendMessage } from './commands'
import { forwardMessage } from './forward'
import { draftKeys, readDraft } from './drafts'
import { DraftSync } from '../draftSync'
import { PostWorker } from './worker'

/** How long after a send its checks may still answer (SPEC section 8). A later grammar answer is dropped. */
export const SENT_CHECK_WINDOW_MILLIS = 120_000

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
    const session = yield* SessionClient
    const drafts = yield* DraftSync
    const sent = new Map<string, { text: string; at: number; workspace: unknown }>()
    const routeBudget = dailyBudget(ROUTE_DAILY_BUDGET)
    const grammar = grammarChecks()
    const checking = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.provideService(Workspace, workspace), Effect.provideService(AiProvider, ai), Effect.provideService(EngineConfig, config))
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
        // The draft went with the message: its row may owe Slack a change.
        if (payload.draftOf !== undefined) yield* drafts.wake
        const at = yield* Clock.currentTimeMillis
        for (const [id, entry] of sent) if (at - entry.at >= SENT_CHECK_WINDOW_MILLIS) sent.delete(id)
        // Checked as the field showed it, the form the edit field opens with, not as Slack encodes it.
        sent.set(payload.clientMsgId, { text: decodeDraft(payload.text).text, at, workspace: yield* workspace.current })
      }))),
      // The send is accepted: local fixes now, and the grammar request for the exact text sent starts.
      'messages.postcheck': ({ clientMsgId }) => Effect.gen(function* () {
        const entry = sent.get(clientMsgId)
        if (entry === undefined || (yield* Clock.currentTimeMillis) - entry.at >= SENT_CHECK_WINDOW_MILLIS) return { grammar: false }
        const checked = yield* postcheckMessage(entry.text, grammar, entry.workspace)
        if (!checked.grammar) sent.delete(clientMsgId)
        return checked
      }).pipe(checking),
      'messages.grammar': ({ clientMsgId }) => Effect.gen(function* () {
        const entry = sent.get(clientMsgId)
        sent.delete(clientMsgId)
        const left = SENT_CHECK_WINDOW_MILLIS - ((yield* Clock.currentTimeMillis) - (entry?.at ?? 0))
        if (entry === undefined || left <= 0) return {}
        return yield* grammarForSent(entry.text, grammar, entry.workspace, left)
      }).pipe(checking),
      'messages.forward': (payload) => provide(forwardMessage(payload).pipe(Effect.provideService(SessionClient, session))),
      'messages.retry': ({ clientMsgId }) => provide(retryMessage(clientMsgId)),
      'messages.discard': ({ clientMsgId }) => provide(discardMessage(clientMsgId)),
      'messages.edit': ({ message, text }) => provide(editMessage(message, text)),
      'messages.broadcast': ({ message }) => provide(broadcastMessage(message)),
      'messages.delete': ({ message }) => provide(deleteMessage(message)),
      'messages.resolveAction': ({ id, retry }) => provide(resolveMessageAction(id, retry)),
      'messages.react': ({ message, name, on }) => provide(reactToMessage(message, name, on)),
      'messages.attachmentAction': (press) => provide(pressButton(press)),
      'messages.check': (payload) => checkMessage(payload).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(EngineConfig, config)),
      'messages.precheck': (payload) => precheckMessage(payload, routeBudget).pipe(checking),
      'drafts.get': ({ topicId }) =>
        serveLiveValue(
          workspace.changes.pipe(
            Stream.switchMap((open) => (open === undefined ? Stream.empty : liveQuery(draftKeys(topicId), timed(readDraft(topicId))).pipe(Stream.provide(open.context)))),
          ),
        ).pipe(retryFirstRun('drafts.get'), Stream.orDie),
      'drafts.set': ({ topicId, text, now }) =>
        Effect.gen(function* () {
          if ((yield* workspace.current) === undefined) return yield* new NotSignedIn()
          yield* drafts.save(topicId, text, now === true)
        }),
    }
  }),
)
