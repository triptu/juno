/**
 * Atoms for the topic view (architecture 7, performance 3.3 and 5).
 *
 * The live queries, one atom per payload:
 * - `messagesAtom(id, window)`: one window of a topic's messages.
 * - `topicAtom(id)`: the header, `TopicDetail | null`.
 * - `channelThreadsAtom(channel)`: Main's active threads.
 *
 * What a topic tab reads, so the list never shows an empty frame when its
 * window moves (performance 5.3):
 * - `messageWindowSpecAtom(id)`: the window the tab wants. The container
 *   writes it (open at the divider, stick to the bottom, prepend).
 * - `messageListAtom(id)`: the window shown. After the spec changes it keeps
 *   the old window until the new one's first snapshot arrives, then swaps in
 *   one update; rows whose `rev` is unchanged keep their objects.
 * - `messageOrderAtom(id)`: the ids, for the list container. Notifies only
 *   when the ids change.
 * - `messageItemAtom(id, ts)`: one message with its sender joined from the
 *   window's refs. Notifies only when the message or its sender changes.
 *
 * The commands: `openTopic(registry, id)` once when a tab shows a topic,
 * `loadOlderMessages(registry, id, before)` when the first row nears the top.
 * Prefetch with `prefetchTopic(registry, id)`; it never calls Slack.
 */
import { Option } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import {
  channelThreads,
  MESSAGE_WINDOW_DEFAULT,
  messagesList,
  messagesLoadOlder,
  THREADS_WINDOW_MAX,
  topicsGet,
  topicsOpen,
  type MessageView,
  type Person,
} from '@juno/contract'
import { liveQuery, prefetch, runCommand } from './atoms'
import type { Registry } from './client'
import { emptyWindow, sameOrder, type ListWindow } from './list'

/** Which messages a tab wants. See `messages.list` in the contract. */
export interface MessageWindowSpec {
  /** A message ts; without it the window is the newest `limit` messages. */
  readonly anchor?: string | undefined
  /** Messages before the anchor. Default `MESSAGE_WINDOW_BEFORE`. */
  readonly before?: number | undefined
  readonly limit: number
}

/** The bottom of the topic, `MESSAGE_WINDOW_DEFAULT` messages. */
export const bottomWindow: MessageWindowSpec = { limit: MESSAGE_WINDOW_DEFAULT }

const listFamily = liveQuery(messagesList)
const topicFamily = liveQuery(topicsGet)
const threadsFamily = liveQuery(channelThreads)

/** One window of a topic's messages, oldest first. */
export const messagesAtom = (id: string, window: MessageWindowSpec = bottomWindow) =>
  listFamily({
    id,
    ...(window.before === undefined ? {} : { before: window.before }),
    range: { ...(window.anchor === undefined ? {} : { anchor: window.anchor }), limit: window.limit },
  })

/** The topic header. `null` for a topic the store does not know. */
export const topicAtom = (id: string) => topicFamily({ id })

/** A channel's threads with activity in the quiet window, newest first. `meta.total` is how many there are. */
export const channelThreadsAtom = (channel: string, limit: number = THREADS_WINDOW_MAX) => threadsFamily({ channel, range: { limit } })

/** The window a topic tab wants. Kept while the app runs, so a hidden tab comes back where it was. */
export const messageWindowSpecAtom = Atom.family((_id: string) => Atom.make<MessageWindowSpec>(bottomWindow).pipe(Atom.keepAlive))

/** The window a topic tab shows, and the spec it belongs to. */
export interface MessageWindow extends ListWindow<MessageView> {
  /** The spec of these rows. It lags `messageWindowSpecAtom` until the new window's first snapshot arrives. */
  readonly spec: MessageWindowSpec
  /** False until the first snapshot of any window has arrived. */
  readonly ready: boolean
  /** The route failed before its first snapshot (an unknown topic id). */
  readonly failed: boolean
}

function carryOver(shown: MessageWindow | undefined, next: ListWindow<MessageView>, spec: MessageWindowSpec): MessageWindow {
  if (shown === undefined) return { ...next, spec, ready: true, failed: false }
  const rows = new Map<string, MessageView>()
  for (const [id, row] of next.rows) {
    const old = shown.rows.get(id)
    rows.set(id, old !== undefined && old.rev === row.rev ? old : row)
  }
  return { order: sameOrder(shown.order, next.order) ? shown.order : next.order, rows, refs: next.refs, meta: next.meta, spec, ready: true, failed: false }
}

/** See the module comment. Reading it subscribes to the current spec's window. */
export const messageListAtom = Atom.family((id: string) =>
  Atom.make((get): MessageWindow => {
    const spec = get(messageWindowSpecAtom(id))
    const result = get(messagesAtom(id, spec))
    const shown = Option.getOrUndefined(get.self<MessageWindow>())
    if (AsyncResult.isFailure(result)) return shown ?? { ...emptyWindow<MessageView>(), spec, ready: false, failed: true }
    if (!AsyncResult.isSuccess(result) || result.value.meta.seq === 0) return shown ?? { ...emptyWindow<MessageView>(), spec, ready: false, failed: false }
    return carryOver(shown, result.value, spec)
  }),
)

export interface MessageOrder {
  readonly ready: boolean
  readonly ids: ReadonlyArray<string>
}

/** The ids of the shown window, oldest first, for the list container. Equal ids do not notify. */
export const messageOrderAtom = Atom.family((id: string) =>
  Atom.make((get): MessageOrder => {
    const window = get(messageListAtom(id))
    return { ready: window.ready, ids: window.order }
  }).pipe(Atom.withEquality((a: MessageOrder, b: MessageOrder) => a.ready === b.ready && sameOrder(a.ids, b.ids))),
)

/** One message as a row draws it: the message and its sender. */
export interface MessageItem {
  readonly message: MessageView
  /** `undefined` for a message with no sender (an unloaded root). */
  readonly sender: Person | undefined
}

const items = new WeakMap<MessageView, MessageItem>()

/** The message `ts` of topic `id` with its sender. Notifies only when the message object or the sender object changes. */
export const messageItemAtom = Atom.family((key: string) => {
  const split = key.indexOf('\u0000')
  const id = key.slice(0, split)
  const ts = key.slice(split + 1)
  return Atom.make((get): MessageItem | undefined => {
    const window = get(messageListAtom(id))
    const message = window.rows.get(ts)
    if (message === undefined) return undefined
    const sender = message.senderId === undefined ? undefined : window.refs.people.get(message.senderId)
    const held = items.get(message)
    if (held !== undefined && held.sender === sender) return held
    const item = { message, sender }
    items.set(message, item)
    return item
  }).pipe(Atom.withEquality((a, b) => a === b))
})

/** `messageItemAtom` for a topic and a message ts. */
export const messageItem = (id: string, ts: string) => messageItemAtom(`${id}\u0000${ts}`)

/** Fetches what the store lacks for a topic a tab now shows. Never in a prefetch. */
export const openTopic = (registry: Registry, id: string) => runCommand(registry, topicsOpen, { id })

/** Makes sure the page before `before` is stored; then widen `messageWindowSpecAtom(id)`. */
export const loadOlderMessages = (registry: Registry, id: string, before: string) => runCommand(registry, messagesLoadOlder, { id, before })

/**
 * Warms a topic for an open (performance 4.2): its header and the window
 * its tab would show, one entry of at most three per registry (`prefetch`).
 * Local queries only.
 */
export function prefetchTopic(registry: Registry, id: string): void {
  prefetch(registry, [messagesAtom(id, registry.get(messageWindowSpecAtom(id))), topicAtom(id)])
}
