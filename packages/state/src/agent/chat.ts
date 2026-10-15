/**
 * The renderer-side state of the Juno chat, over the agent client.
 *
 * - `chatPageAtom(window)`: the agent's page for a window, live. It carries
 *   the view items and, beside them, each card's binding (plan v3 §12, W13).
 * - `chatItemsAtom(window)`: the same page with the owner's sends that the
 *   agent has not stored yet. A send shows at once as `sending`, keyed by
 *   its op id, and the agent's row takes its place once it is in the inbox
 *   (§3: the renderer clears its pending state only after the commit). A
 *   send that could not be stored shows `failed`.
 * - `chatSummaryAtom`: the unread count, busy flag and job line for the
 *   sidebar, the nav item and the home.
 * - `chatActions(registry)`: what the chat's buttons call. Its members match
 *   the RPC-backed callbacks of the views' `ChatActions` (`onCard`,
 *   `onRetry`), plus send, react and read for the composer and the list.
 *
 * Transport errors (a closed port while the agent restarts) are retried
 * every second and never shown; the agent's own errors reach the atom.
 */
import { Effect, Exit, Stream } from 'effect'
import { RpcClientError } from 'effect/rpc/RpcClientError'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import type {
  AgentCommandError,
  CardBinding,
  CardCommand,
  CardId,
  CardChoice,
  ChatItem,
  ChatPage,
  ChatPageSnapshot,
  ChatSummary,
  ChatWindow,
  OpId,
  OwnerMessageItem,
  ReplyTarget,
  Card,
  SendContext,
} from '@juno/agent-contract'
import { aboutOf } from '@juno/agent-contract'
import type { Registry } from '../client'
import { junoAgentOnAtom } from '../shell'
import { AgentClient } from './client'
import { uuidv7 } from './ids'

type Window = typeof ChatWindow.Type
type Snapshot = typeof ChatPageSnapshot.Type
type Binding = typeof CardBinding.Type

const IDLE_TTL = '30 seconds'
const RETRY_DELAY = '1 second'
/** §13.2: longer text is refused locally, before it reaches the agent. */
export const MAX_SEND_BYTES = 65_536

const isRpcClientError = (error: unknown): error is RpcClientError => error instanceof RpcClientError

function live<A, E>(tag: string, payload: unknown): Stream.Stream<A, E, AgentClient> {
  const make = (): Stream.Stream<A, E, AgentClient> =>
    Stream.unwrap(Effect.map(AgentClient, (client) => client(tag as never, payload as never) as unknown as Stream.Stream<A, E | RpcClientError>)).pipe(
      Stream.catchIf(isRpcClientError, () => Stream.unwrap(Effect.map(Effect.sleep(RETRY_DELAY), make))),
    ) as Stream.Stream<A, E, AgentClient>
  return make()
}

/** The latest card views and bindings by card id, from every page seen, for `cardCommand`. */
const cards = new Map<string, { readonly card: Card; readonly binding: Binding }>()

function remember(snapshot: Snapshot): Snapshot {
  for (const binding of snapshot.cards) {
    const item = snapshot.page.items.find((i) => i._tag === 'card' && i.card.id === binding.identity.cardId)
    if (item?._tag === 'card') cards.set(binding.identity.cardId, { card: item.card, binding })
  }
  return snapshot
}

const pageFamily = Atom.family((key: string) =>
  AgentClient.runtime.atom(live<Snapshot, AgentCommandError>('agent.chat.page', { window: JSON.parse(key) as Window }).pipe(Stream.map(remember))).pipe(
    Atom.setIdleTTL(IDLE_TTL),
  ),
)

/** The agent's page for `window`, live. Equal windows share one subscription. */
export const chatPageAtom = (window: Window) => pageFamily(JSON.stringify(window))

export const chatSummaryAtom = AgentClient.runtime
  .atom(live<ChatSummary, never>('agent.chat.summary', undefined))
  .pipe(Atom.keepAlive)

const quiet: ChatSummary = { unread: 0, busy: false }

/**
 * The sidebar's Juno item: the unread count and the busy sparkle. Nothing
 * asks the agent for it while the agent is off, so main is not asked for a
 * port every second for nothing.
 */
export const junoNavAtom = Atom.make((get): ChatSummary => {
  if (!get(junoAgentOnAtom)) return quiet
  const summary = get(chatSummaryAtom)
  return AsyncResult.isSuccess(summary) ? summary.value : quiet
})

/** An owner send the agent has not stored yet, or could not. */
export interface PendingSend {
  readonly opId: OpId
  readonly text: string
  readonly at: number
  readonly context?: SendContext
  readonly replyTo?: ReplyTarget
  readonly delivery: OwnerMessageItem['delivery']
}

export const pendingSendsAtom = Atom.make<ReadonlyArray<PendingSend>>([]).pipe(Atom.keepAlive)

const firstLine = (text: string) => text.trim().split('\n', 1)[0] ?? ''

/** A reply's quote, from the item it points at when the page holds it. */
function quoteIn(items: ReadonlyArray<ChatItem>, target: ReplyTarget): NonNullable<OwnerMessageItem['replyTo']> {
  const found = items.find(
    (item) =>
      (target._tag === 'bubble' && item._tag === 'juno' && item.id === target.id) ||
      (target._tag === 'card' && item._tag === 'card' && item.card.id === target.id) ||
      (target._tag === 'owner' && item._tag === 'owner' && item.opId === target.opId),
  )
  const preview = found?._tag === 'juno' ? firstLine(found.body.map((part) => part.text).join('')) : found?._tag === 'owner' ? firstLine(found.text) : ''
  return { target, preview }
}

/** Pending sends after the page's own items, before the status bubble, once the window reaches the newest row. */
export function withPending(page: ChatPage, pending: ReadonlyArray<PendingSend>): ChatPage {
  if (page.moreBelow || pending.length === 0) return page
  const stored = new Set(page.items.flatMap((item) => (item._tag === 'owner' ? [item.opId] : [])))
  const shown: ReadonlyArray<ChatItem> = pending
    .filter((send) => !stored.has(send.opId))
    .map((send) => ({
      _tag: 'owner',
      opId: send.opId,
      text: send.text,
      at: send.at,
      delivery: send.delivery,
      ...(send.replyTo ? { replyTo: quoteIn(page.items, send.replyTo) } : {}),
      ...(send.context ? { about: aboutOf(send.context) } : {}),
      reactions: [],
      group: 'single',
    }))
  if (shown.length === 0) return page
  const last = page.items.at(-1)
  const items = last?._tag === 'status' ? [...page.items.slice(0, -1), ...shown, last] : [...page.items, ...shown]
  return { ...page, items }
}

/** A row's identity across pages: the op for an owner bubble, the id otherwise. */
function rowKey(item: ChatItem): string {
  switch (item._tag) {
    case 'owner':
      return `o:${item.opId}`
    case 'juno':
      return `j:${item.id}`
    case 'card':
      return `c:${item.card.id}`
    case 'ending':
    case 'status':
      return `${item._tag}:${item.runId}`
    case 'note':
    case 'groupLabel':
      return `${item._tag}:${item.id}`
    case 'day':
      return `d:${item.at}`
    case 'newDivider':
      return 'new'
  }
}

/** The rows seen last, by key, with their JSON, so an unchanged row keeps its object and its memoised view (performance 5.1). */
const seen = new Map<string, { readonly json: string; readonly item: ChatItem }>()
const SEEN_LIMIT = 2_000

function stable(page: ChatPage): ChatPage {
  if (seen.size > SEEN_LIMIT) seen.clear()
  const items = page.items.map((item) => {
    const key = rowKey(item)
    const json = JSON.stringify(item)
    const held = seen.get(key)
    if (held !== undefined && held.json === json) return held.item
    seen.set(key, { json, item })
    return item
  })
  return { ...page, items }
}

const itemsFamily = Atom.family((key: string) =>
  Atom.make((get) => {
    const pending = get(pendingSendsAtom)
    return AsyncResult.map(get(pageFamily(key)), (snapshot) => stable(withPending(snapshot.page, pending)))
  }),
)

/** The page for `window` with the sends the agent has not stored yet. What the chat list renders. */
export const chatItemsAtom = (window: Window) => itemsFamily(JSON.stringify(window))

type CommandResult<A> = Exit.Exit<A, AgentCommandError | RpcClientError>

/** Runs one agent RPC on `registry`'s client and resolves with its exit. */
function call<A>(registry: Registry, tag: string, payload: unknown): Promise<CommandResult<A>> {
  const atom = AgentClient.runtime.fn<unknown>()(() => AgentClient.use((client) => client(tag as never, payload as never) as never))
  const unmount = registry.mount(atom)
  registry.set(atom, undefined)
  return Effect.runPromiseExit(AtomRegistry.getResult(registry, atom as never, { suspendOnWaiting: true })).finally(unmount) as Promise<CommandResult<A>>
}

const byteLength = (text: string) => new TextEncoder().encode(text).length

/** What `cardCommand` did. `signIn` is not the agent's: the container opens main's sign-in window. */
export type CardOutcome = 'sent' | 'failed' | 'unknownCard' | 'signIn'

const choiceOf = (command: CardCommand): typeof CardChoice.Type | undefined => {
  switch (command._tag) {
    case 'send':
      return { _tag: 'send' }
    case 'resolve':
    case 'start':
    case 'apply':
    case 'connect':
    case 'pause':
      return { _tag: command._tag }
    case 'delete':
      return { _tag: 'deleteSchedule' }
    case 'allow':
      return { _tag: 'allowBudget' }
    case 'remove':
      return { _tag: 'remove', alsoRemoveReply: command.alsoReply }
    case 'choose':
      return { _tag: 'answer', answer: { _tag: 'option', optionId: command.optionId } }
    case 'reply':
      return { _tag: 'answer', answer: { _tag: 'text', text: command.text } }
    case 'setUp':
      return { _tag: 'provider', provider: command.provider }
    default:
      return undefined
  }
}

export function chatActions(registry: Registry) {
  const setPending = (opId: OpId, next: PendingSend | undefined) =>
    registry.set(pendingSendsAtom, [...registry.get(pendingSendsAtom).filter((send) => send.opId !== opId), ...(next ? [next] : [])])

  const deliver = async (send: PendingSend) => {
    setPending(send.opId, { ...send, delivery: { _tag: 'sending' } })
    const exit = await call(registry, 'agent.chat.send', {
      opId: send.opId,
      text: send.text,
      ...(send.context ? { context: send.context } : {}),
      ...(send.replyTo ? { replyTo: send.replyTo } : {}),
    })
    if (Exit.isSuccess(exit)) {
      // Stored: the agent's row replaces this one as soon as the page has it.
      setPending(send.opId, { ...send, delivery: { _tag: 'sent' } })
      return
    }
    const error = Exit.isFailure(exit) ? exit.cause.reasons.find((r) => r._tag === 'Fail')?.error : undefined
    const reason = (error as AgentCommandError | undefined)?.reason === 'tooLong' ? 'tooLong' : 'notDelivered'
    setPending(send.opId, { ...send, delivery: { _tag: 'failed', reason } })
  }

  /** Forget stored sends the page has had time to show. */
  const prune = () => {
    const now = Date.now()
    registry.set(
      pendingSendsAtom,
      registry.get(pendingSendsAtom).filter((send) => send.delivery._tag !== 'sent' || now - send.at < 60_000),
    )
  }

  return {
    /** The composer's send. Returns the new op id, the row's key from the first frame. */
    send: (text: string, options: { readonly context?: SendContext; readonly replyTo?: ReplyTarget } = {}): OpId => {
      prune()
      const send: PendingSend = { opId: uuidv7() as OpId, text, at: Date.now(), ...options, delivery: { _tag: 'sending' } }
      if (byteLength(text) > MAX_SEND_BYTES) setPending(send.opId, { ...send, delivery: { _tag: 'failed', reason: 'tooLong' } })
      else void deliver(send)
      return send.opId
    },
    /**
     * "Try again": a send that was not stored goes again with the same op;
     * an owner message whose run was interrupted or failed is resent by the
     * agent under a new op.
     */
    onRetry: (opId: OpId): void => {
      const pending = registry.get(pendingSendsAtom).find((send) => send.opId === opId)
      if (pending?.delivery._tag === 'failed') {
        if (pending.delivery.reason === 'notDelivered') void deliver(pending)
        return
      }
      void call(registry, 'agent.chat.retry', { opId: uuidv7(), interruptedOpId: opId })
    },
    /** The owner's reaction on a Juno bubble or card; `null` removes it. */
    react: (target: Extract<ReplyTarget, { _tag: 'bubble' | 'card' }>, emoji: string | null) =>
      call(registry, 'agent.chat.react', { opId: uuidv7(), target, emoji }),
    /** Juno's items through `through` (a bubble, or an archive message) have been on screen. */
    read: (through: string) => call(registry, 'agent.chat.read', { through }),
    /** A card button. Edits to a Send card's rows are stored first; a choice is prepared, then approved. */
    onCard: (id: CardId, command: CardCommand): Promise<CardOutcome> => cardCommand(registry, id, command),
  }
}

export type ChatCommands = ReturnType<typeof chatActions>

const ok = (exit: CommandResult<unknown>): CardOutcome => (Exit.isSuccess(exit) ? 'sent' : 'failed')

async function cardCommand(registry: Registry, id: CardId, command: CardCommand): Promise<CardOutcome> {
  if (command._tag === 'signIn') return 'signIn'
  const known = cards.get(id)
  if (known === undefined) return 'unknownCard'
  let identity = known.binding.identity
  switch (command._tag) {
    case 'dismiss':
    case 'keep':
      return ok(await call(registry, 'agent.cards.dismiss', { opId: uuidv7(), identity }))
    case 'undo':
      return ok(await call(registry, 'agent.cards.undo', { opId: uuidv7(), identity }))
    case 'askAgain':
      return ok(await call(registry, 'agent.cards.askAgain', { opId: uuidv7(), identity }))
    case 'stop':
      return known.card._tag === 'task' ? ok(await call(registry, 'agent.jobs.stop', { opId: uuidv7(), jobId: known.card.jobId })) : 'failed'
  }
  if (command._tag === 'send' && known.card._tag === 'sendMessage') {
    for (const row of command.texts) {
      if (known.card.messages.find((m) => m.id === row.id)?.text === row.text) continue
      const edited = await call<{ readonly identity: Binding['identity'] }>(registry, 'agent.cards.editMessage', { opId: uuidv7(), identity, messageId: row.id, text: row.text })
      if (!Exit.isSuccess(edited)) return 'failed'
      identity = edited.value.identity
    }
  }
  const choice = choiceOf(command)
  if (choice === undefined) return 'failed'
  const prepared = await call<{ readonly identity: Binding['identity']; readonly children: Binding['children'] }>(registry, 'agent.cards.prepare', {
    opId: uuidv7(),
    identity,
    choice,
  })
  if (!Exit.isSuccess(prepared)) return 'failed'
  if (prepared.value.children.length === 0) return 'sent'
  return ok(await call(registry, 'agent.cards.approve', { opId: uuidv7(), identity: prepared.value.identity, children: prepared.value.children }))
}
