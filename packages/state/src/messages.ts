/**
 * Atoms for the topic view (architecture 7, performance 3.3 and 5).
 *
 * The live queries, one atom per payload:
 * - `messagesAtom(id, window)`: one window of a topic's messages.
 * - `topicAtom(id)`: the header, `TopicDetail | null`.
 * - `channelThreadsAtom(channel)`: Main's active threads.
 * - `whoReactedAtom(channel, ts)`: everyone who reacted to a message, for
 *   the "who reacted" dialog. Mount it only while the dialog is open: the
 *   subscription may fetch the full list from Slack once.
 * - `reactionsWhoAtom(channel, ts)`: everyone who reacted to one message,
 *   for the reactions dialog; mounting it may ask Slack for the full list.
 *
 * What a topic tab reads, so the list never shows an empty frame when its
 * window moves (performance 5.3). Both are keyed by a view, `topicView(id,
 * tabId)`, so two tabs on one topic each keep their own window; the topic
 * id alone is the view outside tabs (peek, and an open
 * still waiting for its first window, which its tab then takes over).
 * - `messageWindowSpecAtom(view)`: the window the tab wants. The container
 *   writes it (open at the divider, stick to the bottom, prepend).
 * - `messageListAtom(view)`: the window shown. After the spec changes it keeps
 *   the old window until the new one's first snapshot arrives, then swaps in
 *   one update; rows whose `rev` is unchanged keep their objects.
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
  messagesLocate,
  peopleLocate,
  reactionsWho,
  THREADS_WINDOW_MAX,
  topicsGet,
  topicsOpen,
  type MessageView,
} from '@juno/contract'
import { liveQuery, prefetch, refreshLive, runCommand } from './atoms'
import type { Registry } from './client'
import { emptyWindow, sameOrder, type ListWindow } from './list'
import { mark } from './perf'
import { traceWindow } from './sendTrace'

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
const whoFamily = liveQuery(reactionsWho)

/** One window of a topic's messages, oldest first. */
export const messagesAtom = (id: string, window: MessageWindowSpec = bottomWindow) =>
  listFamily({
    id,
    ...(window.before === undefined ? {} : { before: window.before }),
    range: { ...(window.anchor === undefined ? {} : { anchor: window.anchor }), limit: window.limit },
  })

/** The topic header. `null` for a topic the store does not know. */
export const topicAtom = (id: string) => topicFamily({ id })

const whoReactedFamily = liveQuery(reactionsWho)

/** Everyone who reacted to a message (`reactions.who`): `WhoReacted`, or `null` for a message the store does not have. */
export const whoReactedAtom = (channel: string, ts: string) => whoReactedFamily({ channel, ts })

/** A channel's threads with activity in the quiet window, newest first. `meta.total` is how many there are. */
export const channelThreadsAtom = (channel: string, limit: number = THREADS_WINDOW_MAX) => threadsFamily({ channel, range: { limit } })

/** Everyone who reacted to one message. `null` for a message the store does not have. */
export const reactionsWhoAtom = (channel: string, ts: string) => whoFamily({ channel, ts })

/** Every thread the store knows in a channel, open ones first, then the resolved ones: the header's topic switcher. */
export const channelTopicsAtom = (channel: string) => threadsFamily({ channel, all: true, range: { limit: THREADS_WINDOW_MAX } })

/** Between a topic id and a tab id in a view key. Neither id can hold it. */
const VIEW_SEPARATOR = '\u0000'

/** A topic as one tab shows it, the key of its window and scroll position. Without a tab, the topic's own view. */
export const topicView = (topicId: string, tabId?: string): string => (tabId === undefined ? topicId : `${topicId}${VIEW_SEPARATOR}${tabId}`)

/** The topic a view shows. */
export const topicOfView = (view: string): string => {
  const at = view.indexOf(VIEW_SEPARATOR)
  return at < 0 ? view : view.slice(0, at)
}

/** The window a topic view wants. Kept while the app runs, so a hidden tab comes back where it was. */
export const messageWindowSpecAtom = Atom.family((_view: string) => Atom.make<MessageWindowSpec>(bottomWindow).pipe(Atom.keepAlive))

/**
 * Topics whose first message the store holds, as `messages.loadOlder` said
 * this run. A topic opened again knows it from its first frame, so it asks
 * for no older page and shows no "Loading older messages".
 */
export const topicStartKnownAtom = Atom.family((_id: string) => Atom.make(false).pipe(Atom.keepAlive))

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
export const messageListAtom = Atom.family((view: string) =>
  Atom.make((get): MessageWindow => {
    const spec = get(messageWindowSpecAtom(view))
    const result = get(messagesAtom(topicOfView(view), spec))
    const shown = Option.getOrUndefined(get.self<MessageWindow>())
    if (AsyncResult.isFailure(result)) return shown ?? { ...emptyWindow<MessageView>(), spec, ready: false, failed: true }
    if (!AsyncResult.isSuccess(result) || result.value.meta.seq === 0) return shown ?? { ...emptyWindow<MessageView>(), spec, ready: false, failed: false }
    traceWindow(view, result.value, spec)
    return carryOver(shown, result.value, spec)
  }),
)

/** Fetches what the store lacks for a topic a tab now shows. Never in a prefetch. */
export const openTopic = (registry: Registry, id: string) => runCommand(registry, topicsOpen, { id })

/** The topic that holds a message (its thread, or Main), for a Juno source link or a Slack link in a message. */
export const locateMessage = (registry: Registry, channel: string, ts: string | undefined, threadTs?: string) =>
  runCommand(registry, messagesLocate, { channel, ...(ts === undefined ? {} : { ts }), ...(threadTs === undefined ? {} : { threadTs }) })

/** A person a Slack profile link names, and your DM with them when you have one. */
export const locatePerson = (registry: Registry, user: string) => runCommand(registry, peopleLocate, { user })

/**
 * A view's window asked for again: its own subscription can start while the
 * topic's first fetch is still writing history (Home's first send to
 * someone never messaged) and miss the change that covers it.
 */
export function refreshMessages(registry: Registry, view: string): void {
  refreshLive(registry, messagesAtom(topicOfView(view), registry.get(messageWindowSpecAtom(view))))
}

/** Makes sure the page before `before` is stored; then widen the view's `messageWindowSpecAtom`. */
export const loadOlderMessages = (registry: Registry, id: string, before: string) => runCommand(registry, messagesLoadOlder, { id, before })

/**
 * Warms a topic for an open (performance 4.2): its header and the window
 * its tab would show, one entry of at most three per registry (`prefetch`).
 * Local queries only.
 */
export function prefetchTopic(registry: Registry, id: string): void {
  mark('juno.prefetch', undefined, { replace: true })
  prefetch(registry, [messagesAtom(id, registry.get(messageWindowSpecAtom(id))), topicAtom(id)])
}
