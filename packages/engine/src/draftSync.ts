/**
 * `DraftSync`: topic drafts in step with Slack's drafts (SPEC 8 "Drafts",
 * architecture 5.7, specs/drafts.qnt, research `slack-drafts.md`), so a
 * draft typed in Juno shows in Slack's apps and the other way round.
 *
 * Out: a local change (`save`) writes the draft and the topic's one `draft`
 * outbox row in one transaction. The row waits for a pause in typing
 * (`draftSaveMillis`, never longer than `draftSaveCapMillis` after it was
 * written), or goes at once when the composer lost focus, its tab hid or
 * its window is closing; quitting sends the rows still waiting. The sender
 * (`draftSend.ts`) sends the topic's text as it is then, one topic at a
 * time. Rows survive restarts and wait while the socket is down. A message sent
 * from a draft names it (`draft_id`, `send/commands.ts`) and Slack retires it.
 *
 * In (`draftVersions.ts`): every catch-up (boot, reconnect) lists Slack's
 * live drafts, as does a lost answer or `attached_draft_exists`; the socket
 * brings `draft_create`, `draft_update`, `draft_delete` and `draft_send`,
 * Juno's own writes included. Each version goes through the rules in
 * `@juno/domain`'s `observeSlackDraft`, which keep typed text and drop
 * Juno's own echoes. Only attached drafts (one per channel or thread, not
 * scheduled) of known conversations count; Slack's other drafts are left
 * alone.
 *
 * A top-level module like `markWorker.ts`: the send and Home features call
 * `save` and `wake`.
 */
import { WorkControl, observeWork } from './workControl'
import { EngineTiming, type EngineTimingConfig } from './config'
import { Clock, Context, Effect, Layer, Queue, Stream } from 'effect'
import { transaction } from '@juno/store'
import { pendingDrafts, recoverDraftSaves, writeLocalDraft } from '@juno/sync'
import { Outbox } from './outbox'
import { SocketEvents } from './socketEvents'
import { SyncLink } from './syncLink'
import { hurry, sendDraftRow, type SenderDeps } from './draftSend'
import { applyDraftEvent, inStore, isDraftFrame, listDrafts } from './draftVersions'
import { Workspace, type OpenWorkspace } from './workspace'

/** Lists in a row after one that could not vouch for a draft linked while it was out. */
const LIST_AGAIN = 3

export class DraftSync extends Context.Service<
  DraftSync,
  {
    /** A local change to a topic's draft; `now` sends it without waiting for a pause in typing. */
    readonly save: (topicId: string, text: string, now: boolean) => Effect.Effect<void>
    /** Look at the pending rows now: a command changed one. */
    readonly wake: Effect.Effect<void>
  }
>()('juno/engine/DraftSync') {
  static readonly layer: Layer.Layer<DraftSync, never, Workspace | Outbox | SyncLink | SocketEvents> = Layer.effect(
    DraftSync,
    Effect.gen(function* () {
      const timing = yield* EngineTiming
      const workspace = yield* Workspace
      const outbox = yield* Outbox
      const link = yield* SyncLink
      const signal = yield* Queue.sliding<void>(1)
      const wake = Effect.asVoid(Queue.offer(signal, undefined))
      const lists = yield* Queue.sliding<number>(1)
      const deps: SenderDeps = { outbox, timing, listSoon: Effect.asVoid(Queue.offer(lists, 0)) }

      const save = (topicId: string, text: string, now: boolean) =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return
          const at = yield* Clock.currentTimeMillis
          yield* inStore(open)(transaction(writeLocalDraft(topicId, text, { now: at, dueAt: now ? at : at + timing.draftSaveMillis, capMillis: timing.draftSaveCapMillis })))
          yield* wake
        })

      /** Sends every due row. Returns how long until the next one is due, or `undefined` when none is pending or the socket is down. */
      const pass = (open: OpenWorkspace) =>
        Effect.gen(function* () {
          // Offline, rows wait for the connection (as posts do) instead of failing into retries.
          if (!(yield* link.online)) return undefined
          const now = yield* Clock.currentTimeMillis
          const due = (yield* inStore(open)(pendingDrafts)).filter((row) => row.nextAt <= now)
          yield* Effect.forEach(due, (row) => sendDraftRow(deps, open, row.topicId), { concurrency: 4, discard: true })
          const rest = yield* inStore(open)(pendingDrafts)
          if (rest.length === 0) return undefined
          return Math.max(0, Math.min(...rest.map((row) => row.nextAt)) - (yield* Clock.currentTimeMillis))
        }).pipe(Effect.catchCause((cause) => Effect.as(Effect.logError('drafts: pass failed', { cause }), timing.workerRetryMillis)))

      /** A list of Slack's drafts, and up to `LIST_AGAIN` more while one could not vouch for what it missed. */
      const listing = (again: number): Effect.Effect<void> =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return
          const more = yield* listDrafts(open, outbox).pipe(Effect.catch((error) => Effect.as(Effect.logWarning('drafts: could not list drafts', { error: error._tag }), true)))
          yield* wake
          if (more && again < LIST_AGAIN) yield* Effect.delay(Queue.offer(lists, again + 1), timing.retryBaseMillis)
        })

      ;(yield* WorkControl).onWake?.('draft', wake)
      yield* run({ workspace, link, timing, signal, lists, wake, pass, listing })
      return DraftSync.of({ save, wake })
    }),
  )
}

interface Loops {
  readonly workspace: Workspace['Service']
  readonly link: SyncLink['Service']
  readonly timing: EngineTimingConfig
  readonly signal: Queue.Queue<void>
  readonly lists: Queue.Queue<number>
  readonly wake: Effect.Effect<void>
  readonly pass: (open: OpenWorkspace) => Effect.Effect<number | undefined>
  readonly listing: (again: number) => Effect.Effect<void>
}

/** The sender's loop, the lists, what wakes them, the socket's draft events, and the last sends when the engine stops. */
const run = ({ workspace, link, timing, signal, lists, wake, pass, listing }: Loops) =>
  Effect.gen(function* () {
    // Quitting sends the rows still waiting for a pause, within the time the app gives the engine to stop.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const open = yield* workspace.current
        if (open === undefined) return
        const now = yield* Clock.currentTimeMillis
        const rows = yield* inStore(open)(pendingDrafts)
        yield* inStore(open)(transaction(Effect.forEach(rows, (row) => hurry(row.topicId, now), { discard: true })))
        yield* pass(open)
      }).pipe(Effect.timeout(timing.draftQuitMillis), Effect.ignore),
    )
    yield* Effect.forkScoped(Effect.gen(function* () {
      while (true) {
        const open = yield* workspace.current
        const wait = yield* (open === undefined ? Effect.succeed(undefined) : pass(open)).pipe(observeWork('draft'))
        yield* Effect.raceFirst(Queue.take(signal), wait === undefined ? Effect.never : Effect.sleep(wait))
      }
    }))
    yield* Effect.forkScoped(Effect.forever(Effect.flatMap(Queue.take(lists), listing)))
    // A workspace that opens (a sign-in, a restart) may hold rows from before; a call that was out then counts as lost.
    yield* Effect.forkScoped(Stream.runForEach(workspace.changes, (open) => open === undefined ? Effect.void : Effect.gen(function* () {
      yield* inStore(open)(transaction(recoverDraftSaves(yield* Clock.currentTimeMillis)))
      yield* wake
    })))
    yield* Effect.forkScoped(Stream.runForEach(link.caughtUps, () => Effect.andThen(wake, Queue.offer(lists, 0))))
    yield* Effect.forkScoped(Stream.runForEach(Stream.filter(link.onlineChanges, (online) => online), () => wake))
    yield* (yield* SocketEvents).subscribe('drafts', Effect.succeed((input) =>
      Effect.gen(function* () {
        if (input._tag !== 'Frame' || !isDraftFrame(input.frame)) return
        const open = yield* workspace.current
        if (open === undefined) return
        yield* inStore(open)(applyDraftEvent(input.frame, yield* Clock.currentTimeMillis))
        yield* wake
      }).pipe(Effect.catchCause((cause) => Effect.logWarning('drafts: an event did not apply', { cause }))),
    ))
  })
