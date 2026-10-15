/**
 * The agent's RPCs for the renderer (`AgentRpcs`, plan v3 §12), served on
 * the ports main brokers between the renderer and the agent (ADR 0012).
 *
 * The chat group is served over the turn engine: the page and summary are
 * rebuilt from the agent's records (`chat.ts`) whenever a run moves, a
 * command lands or presence changes; send, react and retry go to the
 * engine's inbox, and each answers only after the inbox commit.
 *
 * The Juno menu's pages (`pages.ts`) and Settings › Juno
 * (`settings/settings.ts`) are rebuilt on the same signal, and on their own
 * changes. Every page streams, empty where its records come with a later
 * work package; a command whose records do not exist yet (cards,
 * schedules, connections, rules, backup, ownership, review) fails with
 * `unavailable`. Pin edits and settings changes are owner actions on the
 * trusted side: they are written to `agent.sqlite` at FULL before they
 * answer, without an inbox op.
 *
 * The header banner, by precedence: `updateNeeded` (the records are newer
 * than this build), `aiOff` (AI assist is off in Juno), `paused`, `offline`
 * (the host is not live), else `none`. `otherDevice` and `recovery` come
 * with ownership (WP21).
 */
import { Effect, Layer, Queue, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'
import {
  AgentCommandError,
  AgentRpcs,
  ChatMessageId,
  chatCopy,
  type Banner,
  type ChatItem,
  type ChatPage,
  type OpId,
} from '@juno/agent-contract'
import { Revision } from '@juno/agent-cards'
import type { Presence } from '../host/reads'
import type { Turns } from '../router/open'
import type { PinResult } from '../pins/pins'
import type { UpdateNeeded } from '../runtime/core'
import type { JunoSettings } from '../settings/settings'
import { chatItems, chatSummary, readMarkOf, windowOf, type ChatWindow } from './chat'
import { activityPage, emptyRemembers, memoryPage, remembersPage, reviewPage } from './pages'
import { runnerPlatform, type RendererTransport } from './runner'

export interface ChatHost {
  /** The turn engine, the "update needed" stop, or nothing when the engine could not open. */
  readonly turns: Turns | UpdateNeeded | undefined
  readonly presence: () => Presence | undefined
  readonly presenceChanges: Stream.Stream<Presence | undefined>
  /** Settings › Juno, when the engine runs on a model picker. */
  readonly settings?: JunoSettings
}

const unavailable = (message: string) => Effect.fail(new AgentCommandError({ reason: 'unavailable', message }))
const notYet = (what: string) => () => unavailable(`${what} is not available yet.`)
/** How often the Memory page looks for a newly published view: compaction moves it between runs. */
const MEMORY_RECHECK = '2 seconds'

const dayOf = (at: number) => new Date(at).setHours(0, 0, 0, 0)

const readAt = (store: Turns['store']) =>
  (store.db.prepare('SELECT through_at AS at FROM chat_read WHERE singleton = 1').get() as { at: number } | undefined)?.at ?? 0

/** The chat server's state over one engine: the change signal, and when each bubble was first shown. */
function chatState(host: ChatHost) {
  const turns = host.turns?._tag === 'running' ? host.turns : undefined
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of listeners) listener()
  }
  const shown = (id: string, at: number) =>
    turns?.store.db.prepare('INSERT INTO chat_bubbles (id, at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING').run(id, at)
  const unsubscribe = turns?.subscribe((event) => {
    if (event._tag === 'bubble') shown(event.id, Date.now())
    changed()
  })

  /** Emits now, then on every change. */
  const changes: Stream.Stream<void> = Stream.merge(
    Stream.callback<void>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const listener = () => void Queue.offerUnsafe(queue, undefined)
          listener()
          listeners.add(listener)
          return listener
        }),
        (listener) => Effect.sync(() => listeners.delete(listener)),
      ),
    ),
    host.presenceChanges.pipe(Stream.drop(1), Stream.map(() => undefined)),
  )

  const items = (): ReadonlyArray<ChatItem> => {
    if (turns === undefined) return []
    const presence = host.presence()
    const mode = turns.mode()
    return chatItems({
      store: turns.store,
      live: turns.run(),
      seen: (id, fallback) => {
        const known = turns.store.db.prepare('SELECT at FROM chat_bubbles WHERE id = ?').get(id) as { at: number } | undefined
        if (known !== undefined) return known.at
        shown(id, fallback)
        return fallback
      },
      jobs: turns.jobs.list(),
      readAt: readAt(turns.store),
      waiting: mode === 'paused' ? 'resume' : presence?.online === false ? 'network' : undefined,
      dayOf,
    })
  }

  const banner = (): Banner => {
    if (host.turns?._tag === 'updateNeeded') return { _tag: 'updateNeeded' }
    const presence = host.presence()
    if (presence?.aiEnabled === false || turns?.mode() === 'off') return { _tag: 'aiOff' }
    if (turns?.mode() === 'paused') return { _tag: 'paused' }
    if (presence?.online === false) return { _tag: 'offline' }
    return { _tag: 'none' }
  }

  const page = (window: ChatWindow) => {
    const all = items()
    const slice = windowOf(all, window)
    const current = banner()
    const view: ChatPage = {
      items: slice.items,
      banner: current,
      moreAbove: slice.moreAbove,
      moreBelow: slice.moreBelow,
      composerEnabled: turns !== undefined && current._tag !== 'aiOff' && current._tag !== 'updateNeeded',
    }
    const ids = slice.items.flatMap((item) => (item._tag === 'owner' && item.id !== undefined ? [Number(item.id)] : []))
    const versions = turns === undefined || ids.length === 0
      ? []
      : (turns.store.db.prepare(`SELECT id, version FROM messages WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Array<{ id: number; version: number }>)
    return {
      page: view,
      cards: [],
      messages: versions.map((row) => ({ id: ChatMessageId.make(String(row.id)), revision: Revision.make(row.version) })),
    }
  }

  return { turns, changed, changes, items, page, close: () => unsubscribe?.() }
}

/** `build` on every change, emitting only what differs from the last. */
const live = <A>(changes: Stream.Stream<void>, build: () => A): Stream.Stream<A> =>
  changes.pipe(
    Stream.map(build),
    Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
  )

/** A pin change's answer: the op id once written, or why it was refused. */
const pinAnswer = (opId: OpId, result: PinResult) => {
  if (result._tag === 'changed') return Effect.succeed({ opId })
  switch (result.reason) {
    case 'conflict':
    case 'source':
      return Effect.fail(new AgentCommandError({ reason: 'stale', message: chatCopy.pages.remembers.changed }))
    case 'budget':
      return Effect.fail(new AgentCommandError({ reason: 'invalid', message: chatCopy.pages.remembers.full }))
    case 'span':
      return Effect.fail(new AgentCommandError({ reason: 'invalid', message: 'Juno can remember up to 280 bytes of one of your messages.' }))
  }
}

/** The engine, or why a command cannot reach it. */
const engine = (state: ReturnType<typeof chatState>, host: ChatHost) =>
  Effect.suspend(() => {
    if (host.turns?._tag === 'updateNeeded') return unavailable('Juno needs to update its records.')
    if (state.turns === undefined) return unavailable('Juno is not running.')
    if (host.presence()?.aiEnabled === false) return unavailable('AI assist is off.')
    return Effect.succeed(state.turns)
  })

type Accepted = { readonly _tag: 'accepted' } | { readonly _tag: 'recorded' } | { readonly _tag: 'refused'; readonly reason: string }

/** An inbox answer as the RPC's: the op id once it is durable, or why nothing was written. */
const answer = (opId: string, write: () => Accepted) =>
  Effect.suspend(() => {
    let result: Accepted
    try {
      result = write()
    } catch {
      return Effect.fail(new AgentCommandError({ reason: 'notDelivered', message: 'Juno could not store the message.' }))
    }
    switch (result._tag) {
      case 'accepted':
      case 'recorded':
        return Effect.succeed({ opId: opId as never })
      case 'refused':
        return result.reason === 'tooLong'
          ? Effect.fail(new AgentCommandError({ reason: 'tooLong', message: 'The message is too long.' }))
          : result.reason === 'notRetryable'
            ? Effect.fail(new AgentCommandError({ reason: 'invalid', message: 'That message cannot be sent again.' }))
            : unavailable('Juno is off.')
    }
  })

export function agentHandlers(host: ChatHost) {
  return AgentRpcs.toLayer(
    Effect.gen(function* () {
      const state = yield* Effect.acquireRelease(
        Effect.sync(() => chatState(host)),
        (opened) => Effect.sync(opened.close),
      )
      const changed = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.tap(effect, () => Effect.sync(state.changed))
      return AgentRpcs.of({
        'agent.chat.page': ({ window }) =>
          state.changes.pipe(
            Stream.map(() => state.page(window)),
            Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
          ),
        'agent.chat.summary': () =>
          state.changes.pipe(
            Stream.map(() => chatSummary(state.items(), state.turns?.jobs.active() ?? [])),
            Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
          ),
        'agent.chat.send': ({ opId, text, context, replyTo }) =>
          Effect.flatMap(engine(state, host), (turns) =>
            changed(answer(opId, () => turns.accept({ opId, kind: 'send', text, ...(replyTo ? { replyTo } : {}), ...(context ? { data: { context } } : {}) }))),
          ),
        'agent.chat.react': ({ opId, target, emoji }) =>
          Effect.flatMap(engine(state, host), (turns) => changed(answer(opId, () => turns.accept({ opId, kind: 'react', target, emoji })))),
        'agent.chat.retry': ({ opId, interruptedOpId }) =>
          Effect.flatMap(engine(state, host), (turns) => {
            // One Try again per failure: a second click names the retry already queued or running.
            const queued = turns.store.db
              .prepare(
                "SELECT op_id AS opId FROM inbox WHERE kind = 'retry' AND json_extract(data, '$.retryOf') = ? AND state NOT IN ('interrupted', 'failed') LIMIT 1",
              )
              .get(interruptedOpId) as { opId: OpId } | undefined
            if (queued !== undefined && queued.opId !== opId) return Effect.succeed({ opId: queued.opId })
            return changed(answer(opId, () => turns.retry({ opId, interruptedOpId })))
          }),
        'agent.chat.read': ({ through }) =>
          Effect.sync(() => {
            const turns = state.turns
            if (turns === undefined) return
            const at = readMarkOf(state.items(), through)
            if (at === undefined) return
            turns.store.db
              .prepare('INSERT INTO chat_read (singleton, through_at) VALUES (1, ?) ON CONFLICT (singleton) DO UPDATE SET through_at = max(through_at, excluded.through_at)')
              .run(at)
            state.changed()
          }),
        'agent.chat.remove': notYet('Removing a message'),

        'agent.cards.prepare': notYet('This card'),
        'agent.cards.approve': notYet('This card'),
        'agent.cards.dismiss': notYet('This card'),
        'agent.cards.askAgain': notYet('This card'),
        'agent.cards.editMessage': notYet('This card'),
        'agent.cards.undo': notYet('This card'),
        'agent.jobs.stop': ({ opId, jobId }) =>
          Effect.flatMap(engine(state, host), (turns) => changed(Effect.promise(() => turns.jobs.stop(jobId)).pipe(Effect.as({ opId })))),

        'agent.scheduled.page': () => Stream.make({ page: { schedules: [] }, revisions: [] }),
        'agent.scheduled.edit': notYet('Scheduled'),
        'agent.scheduled.action': notYet('Scheduled'),
        'agent.remembers.page': () => (state.turns === undefined ? Stream.make(emptyRemembers) : live(state.changes, () => remembersPage(state.turns!.store))),
        'agent.remembers.edit': ({ opId, id, revision, text }) =>
          Effect.flatMap(engine(state, host), (turns) => changed(Effect.suspend(() => pinAnswer(opId, turns.pins.edit({ id, version: revision }, text))))),
        'agent.remembers.remove': ({ opId, id, revision }) =>
          Effect.flatMap(engine(state, host), (turns) => changed(Effect.suspend(() => pinAnswer(opId, turns.pins.undo({ id, version: revision }))))),
        'agent.remembers.pin': ({ opId, messageId, revision, startByte, endByte }) =>
          Effect.flatMap(engine(state, host), (turns) =>
            changed(
              Effect.suspend(() => {
                const message = turns.store.db.prepare('SELECT version FROM messages WHERE id = ?').get(Number(messageId)) as { version: number } | undefined
                if (message?.version !== revision) return Effect.fail(new AgentCommandError({ reason: 'stale', message: 'That message changed.' }))
                return pinAnswer(opId, turns.pins.pinMessage({ messageId: Number(messageId), from: startByte, to: endByte }))
              }),
            ),
          ),
        'agent.memory.page': ({ window }) =>
          state.turns === undefined
            ? Stream.make({ lines: [] })
            : live(Stream.merge(state.changes, Stream.tick(MEMORY_RECHECK)), () => memoryPage(state.turns!.store, window)),
        'agent.activity.page': ({ window }) =>
          state.turns === undefined ? Stream.make({ runs: [], moreAbove: false }) : live(state.changes, () => activityPage(state.turns!.store, window)),
        'agent.connections.page': () => Stream.make({ connections: [] }),
        'agent.connections.action': notYet('Connections'),
        'agent.connections.tier': notYet('Connections'),
        'agent.connections.address': notYet('Connections'),
        'agent.review.page': () => Stream.make(reviewPage()),
        'agent.review.activate': notYet('Review'),
        'agent.settings.page': () => {
          const settings = host.settings
          if (settings === undefined) return Stream.die(new Error('Settings › Juno needs the engine'))
          const own = Stream.callback<void>((queue) =>
            Effect.acquireRelease(
              Effect.sync(() => settings.subscribe(() => void Queue.offerUnsafe(queue, undefined))),
              (unsubscribe) => Effect.sync(unsubscribe),
            ),
          )
          return live(Stream.merge(state.changes, own), settings.page)
        },
        // Settings change with AI assist off too: only Pause needs the engine on.
        // Pause shows in the chat's banner and waiting lines, so a change rebuilds the chat page too.
        'agent.settings.change': ({ opId, change }) =>
          changed(
            Effect.suspend(() => {
              if (host.settings === undefined) return unavailable('Juno is not running.')
              const result = host.settings.change(change)
              return result._tag === 'done' ? Effect.succeed({ opId }) : Effect.fail(new AgentCommandError({ reason: result.reason, message: result.message }))
            }),
          ),
        'agent.settings.credentials': notYet('Signing in to Codex'),
        'agent.settings.ownership': notYet('Moving Juno'),
      })
    }),
  )
}

/** Serves `AgentRpcs` on every renderer port `transport` gives, for as long as the layer lives. */
export function rendererServer(transport: RendererTransport, host: ChatHost) {
  return RpcServer.layer(AgentRpcs, { disableFatalDefects: true, disableTracing: true, spanPrefix: 'juno-agent' }).pipe(
    Layer.provide(agentHandlers(host)),
    Layer.provide(RpcServer.layerProtocolWorkerRunner),
    Layer.provide(runnerPlatform(transport)),
  )
}
