/**
 * The agent's RPCs for the renderer (`AgentRpcs`, plan v3 §12), served on
 * the ports main brokers between the renderer and the agent (ADR 0012).
 *
 * The chat group is served over the turn engine: the page and summary are
 * rebuilt from the agent's records (`chat.ts`) whenever a run moves, a
 * command lands or presence changes; send, react and retry go to the
 * engine's inbox, and each answers only after the inbox commit. The card
 * group goes to the engine's actions (WP15): a click, a dismissal or an
 * edit answers after its FULL commit, and dispatch follows in the
 * background. The page lists every card, with the binding a click must
 * return for each card still open.
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
 * The header banner, by precedence: `otherDevice` (this Mac released Juno:
 * every command is refused as read-only), `updateNeeded` (the records are
 * newer than this build), `recovery` (restored from backup: sends wait for
 * the review, and open cards may already have happened), `aiOff` (AI
 * assist is off in Juno), `paused`, `offline` (the host is not live), else
 * `none`.
 */
import { Effect, Layer, Queue, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'
import {
  AgentCommandError,
  AgentRpcs,
  ChatMessageId,
  chatCopy,
  type CardChoice,
  type Banner,
  type ChatItem,
  type ChatPage,
  type OpId,
} from '@juno/agent-contract'
import { authorityOf } from '../grants/grants'
import { mayAuthorize } from '../policy/policy'
import { pinNotes } from './pin-notes'
import { messageMenu } from './message-menu'
import { Revision } from '@juno/agent-cards'
import { watchReplyCommand, type WatchHost } from '../schedule/commands'
import type { Scheduler } from '../schedule/scheduler'
import { bindingOf, cardRow, payloadOf, type Choice } from '../actions/cards'
import type { Presence } from '../host/reads'
import type { Turns } from '../router/open'
import type { PinResult } from '../pins/pins'
import type { UpdateNeeded } from '../runtime/core'
import { backupFailure } from '../backup/errors'
import { connectionHandlers } from '../mcp/pages'
import type { McpManagerApi } from '../mcp/manager'
import type { JunoSettings } from '../settings/settings'
import { thumbOf } from '../router/files'
import { createChatCache, chatSummary, readMarkOf, windowOf, type ChatWindow } from './chat'
import { activityPage, emptyRemembers, memoryPage, remembersPage, reviewPage } from './pages'
import { askLines, askViews, docNotes, docsPage } from '../memory-docs/views'
import { entryId, ownerAdd, ownerDelete, ownerEdit, undoRun, type WriteResult } from '../memory-docs/store'
import { dismiss } from '../memory-docs/asks'
import { deletePerson, setRelationship } from '../memory-docs/people'
import { runnerPlatform, type RendererTransport } from './runner'

export interface ChatHost {
  /** The turn engine, the "update needed" stop, or nothing when the engine could not open. */
  readonly turns: Turns | UpdateNeeded | undefined
  readonly presence: () => Presence | undefined
  readonly presenceChanges: Stream.Stream<Presence | undefined>
  /** Settings › Juno, when the engine runs on a model picker. */
  readonly settings?: JunoSettings
  readonly connections?: McpManagerApi
  readonly schedule?: { readonly scheduler: Scheduler; readonly host: WatchHost }
  /** Errors the owner sees only as a plain line; the log keeps them. */
  readonly report?: (error: unknown) => void
}

const unavailable = (message: string) => Effect.fail(new AgentCommandError({ reason: 'unavailable', message }))
const notYet = (what: string) => () => unavailable(`${what} is not available yet.`)
const readOnly = () => Effect.fail(new AgentCommandError({ reason: 'readOnly', message: chatCopy.banner.otherDevice.line }))
/**
 * Backup folder work; a folder Juno cannot read or write is the command's error, not a defect. The owner
 * reads what to do; `report` gets the original error.
 */
const folderWork = <A>(f: () => Promise<A>, report?: (error: unknown) => void) =>
  Effect.tryPromise({
    try: f,
    catch: (error) => {
      report?.(error)
      return new AgentCommandError(backupFailure(error))
    },
  })
/** An ownership command's refusal as the RPC's error. */
const ownershipAnswer = (opId: OpId, result: { readonly _tag: string } | { readonly _tag: 'refused'; readonly reason: 'unavailable' | 'readOnly' | 'invalid' | 'stale'; readonly message: string }) =>
  'reason' in result ? Effect.fail(new AgentCommandError({ reason: result.reason, message: result.message })) : Effect.succeed({ opId })
/** How often the Memory page looks for a newly published view: compaction moves it between runs. */
const MEMORY_RECHECK = '2 seconds'

/** A card command the ledger refused, as the RPC's error. */
const refused = (result: { readonly _tag: 'refused'; readonly reason: 'stale' | 'expired' | 'invalid' }) =>
  Effect.fail(
    new AgentCommandError({
      reason: result.reason,
      message: result.reason === 'expired' ? 'This card has expired.' : result.reason === 'stale' ? 'This card has changed.' : 'This card does not take that.',
    }),
  )

/** The data a button carries into the payload, or undefined for a button that approves the card as it is. */
function choiceOf(choice: typeof CardChoice.Type): Choice | undefined {
  switch (choice._tag) {
    case 'answer':
      return { _tag: 'answer', answer: choice.answer }
    case 'keep':
      return { _tag: 'schedule', action: 'keep' }
    case 'pause':
      return { _tag: 'schedule', action: 'pause' }
    case 'deleteSchedule':
      return { _tag: 'schedule', action: 'delete' }
    case 'remove':
      return { _tag: 'remove', alsoRemoveReply: choice.alsoRemoveReply }
    case 'provider':
      return { _tag: 'provider', provider: choice.provider }
    default:
      return undefined
  }
}

const dayOf = (at: number) => new Date(at).setHours(0, 0, 0, 0)

const readAt = (store: Turns['store']) =>
  (store.db.prepare('SELECT through_at AS at FROM chat_read WHERE singleton = 1').get() as { at: number } | undefined)?.at ?? 0

/** The chat server's state over one engine: the change signal, and when each bubble was first shown. */
function chatState(host: ChatHost) {
  const turns = host.turns?._tag === 'running' ? host.turns : undefined
  const cache = turns === undefined ? undefined : createChatCache(turns.store, () => changed())
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
  const unsubscribeCards = turns?.actions.subscribe(changed)

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

  const views = () => (turns === undefined ? [] : turns.actions.views().map(turns.ownership.restored))
  const items = (cards = views()): ReadonlyArray<ChatItem> => {
    if (turns === undefined) return []
    const presence = host.presence()
    const mode = turns.mode()
    const recovery = turns.ownership.owner().state === 'recovery'
    return pinNotes(turns.store, cache!.items({
      store: turns.store,
      live: turns.run(),
      seen: (id, fallback) => {
        const known = turns.store.db.prepare('SELECT at FROM chat_bubbles WHERE id = ?').get(id) as { at: number } | undefined
        if (known !== undefined) return known.at
        shown(id, fallback)
        return fallback
      },
      jobs: turns.jobs.list(),
      cards,
      readAt: readAt(turns.store),
      waiting: recovery ? 'review' : mode === 'paused' ? 'resume' : presence?.online === false ? 'network' : undefined,
      dayOf,
      lines: [...docNotes(turns.store), ...askLines(askViews(turns.store, host.connections))],
    }))
  }

  const banner = (): Banner => {
    const owner = turns?.ownership.owner()
    if (owner?.state === 'released') return { _tag: 'otherDevice', deviceName: owner.deviceName ?? '' }
    if (host.turns?._tag === 'updateNeeded') return { _tag: 'updateNeeded' }
    if (owner?.state === 'recovery') return { _tag: 'recovery', pending: turns!.ownership.pending() }
    const presence = host.presence()
    if (presence?.aiEnabled === false || turns?.mode() === 'off') return { _tag: 'aiOff' }
    if (turns?.mode() === 'paused') return { _tag: 'paused' }
    if (presence?.online === false) return { _tag: 'offline' }
    return { _tag: 'none' }
  }

  const page = (window: ChatWindow) => {
    const cards = views()
    const all = items(cards)
    const slice = windowOf(all, window)
    const current = banner()
    const view: ChatPage = {
      items: slice.items,
      banner: current,
      moreAbove: slice.moreAbove,
      moreBelow: slice.moreBelow,
      composerEnabled: turns !== undefined && current._tag !== 'aiOff' && current._tag !== 'updateNeeded' && current._tag !== 'otherDevice',
    }
    const ids = slice.items.flatMap((item) => (item._tag === 'owner' && item.id !== undefined ? [Number(item.id)] : []))
    const versions = turns === undefined || ids.length === 0
      ? []
      : (turns.store.db.prepare(`SELECT id, version FROM messages WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Array<{ id: number; version: number }>)
    return {
      page: view,
      cards: cards.flatMap((entry) => {
        if (!slice.items.some((item) => item._tag === 'card' && item.card.id === entry.card.id)) return []
        if (entry.binding) return [entry.binding]
        if (turns && 'status' in entry.card && entry.card.status._tag === 'expired') {
          const row = cardRow(turns.store, entry.card.id)
          if (row) return [{ identity: bindingOf(row, payloadOf(turns.store, row)).identity, children: [] }]
        }
        return []
      }),
      messages: versions.map((row) => ({ id: ChatMessageId.make(String(row.id)), revision: Revision.make(row.version) })),
    }
  }

  return {
    turns, changed, changes, items, page,
    close: () => {
      cache?.close()
      unsubscribe?.()
      unsubscribeCards?.()
    },
  }
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

/** An owner change to Juno's memory of them: the op id once written, or why it was refused. */
const docAnswer = (opId: OpId, result: WriteResult) => {
  if (result._tag === 'written') return Effect.succeed({ opId })
  const copy = chatCopy.docs.refused
  switch (result.reason) {
    case 'stale':
    case 'unknownEntry':
      return Effect.fail(new AgentCommandError({ reason: 'stale', message: copy.stale }))
    case 'empty':
      return Effect.fail(new AgentCommandError({ reason: 'invalid', message: copy.empty }))
    case 'tooLong':
      return Effect.fail(new AgentCommandError({ reason: 'invalid', message: copy.tooLong }))
    case 'secret':
      return Effect.fail(new AgentCommandError({ reason: 'invalid', message: copy.secret }))
    case 'full':
    case 'docFull':
      return Effect.fail(new AgentCommandError({ reason: 'invalid', message: copy.full }))
    case 'sectionFull':
    case 'fileFull':
      return Effect.fail(new AgentCommandError({ reason: 'invalid', message: copy.fileFull }))
    // The owner's own words are never refused as sensitive; a file that went is a change under the page.
    case 'sensitive':
    case 'unknownPerson':
      return Effect.fail(new AgentCommandError({ reason: 'stale', message: copy.stale }))
  }
}

/**
 * The engine for an owner change that needs no model: the memory page's
 * edits work paused, offline and with AI assist off, as Remove does.
 */
const local = (state: ReturnType<typeof chatState>, host: ChatHost) =>
  Effect.suspend(() => {
    if (host.turns?._tag === 'updateNeeded') return unavailable('Juno needs to update its records.')
    if (state.turns === undefined) return unavailable('Juno is not running.')
    if (state.turns.ownership.owner().state === 'released') return readOnly()
    return Effect.succeed(state.turns)
  })

/** The engine, or why a command cannot reach it. */
const engine = (state: ReturnType<typeof chatState>, host: ChatHost) =>
  Effect.suspend(() => {
    if (host.turns?._tag === 'updateNeeded') return unavailable('Juno needs to update its records.')
    if (state.turns === undefined) return unavailable('Juno is not running.')
    if (state.turns.ownership.owner().state === 'released') return readOnly()
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

const READS_RECHECK = '2 seconds'

/**
 * Whether the chat model takes images, as OpenRouter's catalogue (or pi-ai's,
 * or a custom endpoint's row) says. Codex turns go as text, so not there.
 */
function readsImages(turns: Turns | undefined): boolean {
  if (turns === undefined) return false
  const chat = turns.models().chat
  if (chat.provider === 'openai-codex') return false
  return turns.guard.models.getModel(chat.provider, chat.modelId)?.input.includes('image') ?? false
}

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
          Stream.merge(state.changes, Stream.tick('1 second')).pipe(
            Stream.map(() => state.page(window)),
            Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
          ),
        'agent.chat.summary': () =>
          state.changes.pipe(
            Stream.map(() => ({ ...chatSummary(state.items(), state.turns?.jobs.active() ?? []), mayAuthorize: state.turns !== undefined && host.presence()?.aiEnabled !== false && mayAuthorize(authorityOf(state.turns.store)) })),
            Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
          ),
        'agent.chat.send': ({ opId, text, context, replyTo, files }) =>
          Effect.flatMap(engine(state, host), (turns) =>
            changed(answer(opId, () => turns.accept({
              opId, kind: 'send', text, ...(replyTo ? { replyTo } : {}), ...(context ? { data: { context } } : {}), ...(files !== undefined && files.length > 0 ? { files } : {}),
            }))),
          ),
        'agent.chat.image': ({ opId, n }) => Effect.sync(() => (state.turns === undefined ? null : (thumbOf(state.turns.store, opId, n) ?? null))),
        // A model change in Settings is not a chat change: look again every few seconds too.
        'agent.chat.reads': () =>
          Stream.merge(state.changes, Stream.tick(READS_RECHECK)).pipe(
            Stream.map(() => ({ images: readsImages(state.turns) })),
            Stream.changesWith((a, b) => a.images === b.images),
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
        // The owner's Remove is a local sheet: it works paused, offline and with AI assist off (SPEC 13.8).
        'agent.chat.message': ({ target }) => Effect.sync(() => state.turns === undefined ? null : messageMenu(state.turns.store, target)),
        'agent.chat.remove': ({ opId, messageId, alsoRemoveReply }) =>
          Effect.suspend(() => {
            const turns = state.turns
            if (host.turns?._tag === 'updateNeeded') return unavailable('Juno needs to update its records.')
            if (turns === undefined) return unavailable('Juno is not running.')
            return changed(
              Effect.tryPromise({
                try: () => turns.redaction.remove({ opId, messageIds: [Number(messageId)], alsoRemoveReply }),
                catch: () => new AgentCommandError({ reason: 'notDelivered', message: 'Juno could not remove the message.' }),
              }).pipe(
                Effect.flatMap((result) =>
                  result._tag === 'notFound' ? Effect.fail(new AgentCommandError({ reason: 'stale', message: 'That message is not in the chat.' })) : Effect.succeed({ opId }),
                ),
              ),
            )
          }),

        'agent.cards.prepare': ({ identity, choice }) =>
          Effect.flatMap(engine(state, host), (turns) => {
            const prepared = choiceOf(choice)
            if (prepared === undefined) {
              // A button with no data approves the card as it is.
              const view = turns.actions.views().find((v) => v.card.id === identity.cardId)
              if (view?.binding === undefined) return refused({ _tag: 'refused', reason: view === undefined ? 'invalid' : 'stale' })
              return Effect.succeed({ card: view.card, identity: view.binding.identity, children: view.binding.children })
            }
            const result = turns.actions.prepare(identity, prepared)
            if ('_tag' in result) return refused(result)
            const view = turns.actions.views().find((v) => v.card.id === identity.cardId)!
            return Effect.succeed({ card: view.card, identity: result.identity, children: result.children })
          }),
        'agent.cards.approve': ({ opId, identity, children }) =>
          Effect.flatMap(engine(state, host), (turns) => {
            const result = turns.actions.approve(opId, identity, children)
            return result._tag === 'accepted' ? Effect.succeed({ opId }) : refused(result)
          }),
        'agent.cards.dismiss': ({ opId, identity }) =>
          Effect.flatMap(engine(state, host), (turns) => {
            const result = turns.actions.dismiss(identity)
            return result._tag === 'accepted' ? Effect.succeed({ opId }) : refused(result)
          }),
        'agent.cards.askAgain': ({ opId, identity }) =>
          Effect.flatMap(engine(state, host), (turns) => {
            const view = turns.actions.views().find((v) => v.card.id === identity.cardId)
            if (view === undefined || !('status' in view.card) || view.card.status._tag !== 'expired') return refused({ _tag: 'refused', reason: 'invalid' })
            // A message from the owner that quotes the card: a fresh read brings a fresh card.
            return changed(answer(opId, () => turns.accept({ opId, kind: 'send', text: chatCopy.card.askAgain, replyTo: { _tag: 'card', id: identity.cardId } })))
          }),
        'agent.cards.editMessage': ({ identity, messageId, text }) =>
          Effect.flatMap(engine(state, host), (turns) => {
            const result = turns.actions.editMessage(identity, messageId, text)
            if ('_tag' in result) return refused(result)
            const view = turns.actions.views().find((v) => v.card.id === identity.cardId)!
            return Effect.succeed({ card: view.card, identity: result.identity })
          }),
        'agent.cards.undo': ({ opId, identity }) => Effect.flatMap(engine(state, host), (turns) =>
          Effect.promise(() => turns.actions.undo(identity)).pipe(Effect.flatMap((done) => done ? Effect.succeed({ opId }) : refused({ _tag: 'refused', reason: 'stale' })))),
        'agent.jobs.stop': ({ opId, jobId }) =>
          Effect.flatMap(engine(state, host), (turns) => changed(Effect.promise(() => turns.jobs.stop(jobId, opId)).pipe(Effect.as({ opId })))),

        'agent.scheduled.page': () => host.schedule === undefined ? Stream.make({ page: { schedules: [] }, revisions: [] }) : live(Stream.merge(state.changes, Stream.tick(MEMORY_RECHECK)), host.schedule.scheduler.page),
        'agent.schedule.watchReply': (input) => {
          const turns = state.turns
          return host.schedule === undefined || turns === undefined ? unavailable('Reply watches are not available yet.') : watchReplyCommand({ store: turns.store, scheduler: host.schedule.scheduler, propose: turns.actions.propose }, host.schedule.host, input)
        },
        'agent.scheduled.edit': ({ opId, id, revision, what, schedule, deliver }) => Effect.suspend(() => {
          const scheduler = host.schedule?.scheduler
          if (scheduler === undefined) return unavailable('Scheduled is not available yet.')
          const row = scheduler.get(id)
          const done = scheduler.command(opId, () => row !== undefined && scheduler.edit(id, revision, opId, { ...row.definition, what, schedule, deliver }))
          return done ? Effect.succeed({ opId }) : Effect.fail(new AgentCommandError({ reason: 'stale', message: 'This schedule changed.' }))
        }),
        'agent.scheduled.action': ({ opId, id, revision, action }) => Effect.suspend(() => {
          if (host.schedule === undefined) return unavailable('Scheduled is not available yet.')
          const scheduler = host.schedule.scheduler
          const done = scheduler.command(opId, () => action === 'resume' ? scheduler.resume(id, revision, opId) : scheduler.cancel(id, revision, action === 'pause' ? 'paused' : 'deleted'))
          return done ? Effect.succeed({ opId }) : Effect.fail(new AgentCommandError({ reason: 'stale', message: 'This schedule changed.' }))
        }),
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
                return pinAnswer(opId, turns.pins.pinMessage({ id: opId, messageId: Number(messageId), from: startByte, to: endByte }))
              }),
            ),
          ),
        'agent.docs.page': () => (state.turns === undefined ? Stream.make({ page: { docs: [], people: [], changes: [] }, revisions: [] }) : live(state.changes, () => docsPage(state.turns!.store))),
        'agent.docs.add': ({ opId, doc, text, person, section }) =>
          Effect.flatMap(local(state, host), (turns) => changed(Effect.suspend(() => docAnswer(opId, ownerAdd(turns.store, { opId, doc, text, ...(person === undefined ? {} : { person, ...(section === undefined ? {} : { section }) }) }))))),
        'agent.docs.relationship': ({ opId, person, revision, relationship }) =>
          Effect.flatMap(local(state, host), (turns) => changed(Effect.suspend(() =>
            setRelationship(turns.store, { person, relationship, by: 'owner', expected: revision })._tag === 'set'
              ? Effect.succeed({ opId })
              : Effect.fail(new AgentCommandError({ reason: 'stale', message: chatCopy.docs.refused.stale }))))),
        'agent.docs.deletePerson': ({ opId, person }) =>
          Effect.flatMap(local(state, host), (turns) => changed(Effect.suspend(() =>
            deletePerson(turns.store, { person }) ? Effect.succeed({ opId }) : Effect.fail(new AgentCommandError({ reason: 'stale', message: chatCopy.docs.refused.stale }))))),
        'agent.docs.edit': ({ opId, id, revision, text }) =>
          Effect.flatMap(local(state, host), (turns) => changed(Effect.suspend(() => docAnswer(opId, ownerEdit(turns.store, { opId, entry: entryId(id) ?? -1, version: revision, text }))))),
        'agent.docs.delete': ({ opId, id, revision }) =>
          Effect.flatMap(local(state, host), (turns) => changed(Effect.suspend(() => docAnswer(opId, ownerDelete(turns.store, { entry: entryId(id) ?? -1, version: revision }))))),
        'agent.docs.undo': ({ opId, run }) =>
          Effect.flatMap(local(state, host), (turns) => changed(Effect.suspend(() =>
            undoRun(turns.store, run) > 0 ? Effect.succeed({ opId }) : Effect.fail(new AgentCommandError({ reason: 'stale', message: chatCopy.docs.refused.stale }))))),
        'agent.asks.list': () => (state.turns === undefined ? Stream.make({ asks: [] }) : live(state.changes, () => ({ asks: askViews(state.turns!.store, host.connections) }))),
        'agent.asks.answer': ({ opId, id, answer: choice }) =>
          // Not now and Stop are the owner's alone; Start needs Juno on, as a pass calls the model.
          Effect.flatMap(choice === 'start' ? engine(state, host) : local(state, host), (turns) =>
            changed(Effect.suspend(() => {
              if (choice === 'dismiss') {
                if (!dismiss(turns.store, id)) return Effect.fail(new AgentCommandError({ reason: 'stale', message: 'This changed.' }))
                turns.learning.notify()
                return Effect.succeed({ opId })
              }
              if (choice === 'stop') return Effect.promise(() => turns.learning.stop(id)).pipe(Effect.as({ opId }))
              if (turns.mode() !== 'on') return unavailable('Juno is paused.')
              return turns.learning.start(id) ? Effect.succeed({ opId }) : Effect.fail(new AgentCommandError({ reason: 'stale', message: 'This changed.' }))
            }))),
        'agent.memory.page': ({ window }) =>
          state.turns === undefined
            ? Stream.make({ lines: [] })
            : live(Stream.merge(state.changes, Stream.tick(MEMORY_RECHECK)), () => memoryPage(state.turns!.store, window)),
        'agent.activity.page': ({ window }) =>
          state.turns === undefined ? Stream.make({ runs: [], moreAbove: false }) : live(state.changes, () => activityPage(state.turns!.store, window)),
        'agent.connections.page': () => host.connections ? connectionHandlers(host.connections).page() : Stream.make({ connections: [] }),
        'agent.connections.action': (input) => host.connections ? connectionHandlers(host.connections).action(input) : notYet('Connections')(),
        'agent.connections.tool': (input) => host.connections ? connectionHandlers(host.connections).tool(input) : notYet('Connections')(),
        'agent.connections.rule': (input) => host.connections ? connectionHandlers(host.connections).rule(input) : notYet('Connections')(),
        'agent.connections.address': (input) => host.connections ? connectionHandlers(host.connections).address(input) : notYet('Connections')(),
        'agent.connections.add': (input) => host.connections ? connectionHandlers(host.connections).add(input) : notYet('Connections')(),
        'agent.review.page': () => (state.turns === undefined ? Stream.make(reviewPage()) : live(state.changes, () => state.turns!.ownership.review())),
        // Activate is the owner's, on the trusted side: AI assist off does not block it.
        'agent.review.activate': ({ opId, backupAt }) =>
          changed(
            Effect.suspend(() =>
              state.turns === undefined ? unavailable('Juno is not running.') : ownershipAnswer(opId, state.turns.ownership.activate({ backupAt })),
            ),
          ),
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
              const settings = host.settings
              if (settings === undefined) return unavailable('Juno is not running.')
              return Effect.promise(async () => settings.change(change)).pipe(
                Effect.flatMap((result) => (result._tag === 'done' ? Effect.succeed({ opId }) : Effect.fail(new AgentCommandError({ reason: result.reason, message: result.message })))),
              )
            }),
          ),
        'agent.settings.credentials': notYet('Signing in to Codex'),
        'agent.settings.ownership': ({ opId, action }) =>
          changed(
            Effect.suspend(() => {
              const turns = state.turns
              if (turns === undefined) return unavailable('Juno is not running.')
              switch (action._tag) {
                case 'exportPhrase':
                  return turns.backup === undefined
                    ? unavailable('Backup is not available on this Mac.')
                    : folderWork(() => turns.backup!.exportPhrase(), host.report).pipe(Effect.as({ opId }))
                case 'move':
                  return folderWork(() => turns.ownership.move(), host.report).pipe(Effect.flatMap((result) => ownershipAnswer(opId, result)))
                case 'restore':
                  return folderWork(() => turns.ownership.restore(action.backupPath), host.report).pipe(Effect.flatMap((result) => ownershipAnswer(opId, result)))
              }
            }),
          ),
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
