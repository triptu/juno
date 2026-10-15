/** Shared session composition and host seam for the notifications feature. */
import { ChannelId, UserId, isDm, messageMentionsMe, type Me, type Presence } from '@juno/domain'
import { makeNotifications, readSettings, type Notifier, type Notifications } from '@juno/notifications'
import { messageBody, plainText } from '@juno/richtext'
import { SlackApi, SlackSession, type SocketEvent } from '@juno/slack'
import type { NotificationSource, NotificationTarget } from '@juno/contract'
import { liveQuery, StoreReader, type ConversationRow } from '@juno/store'
import { Clock, Context, Effect, Layer, Queue, Ref, Stream, SubscriptionRef } from 'effect'
import { HostLink } from './protocol/host'

const safe = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.catch(() => Effect.logWarning('notifications: operation failed')))
const run = (effect: Effect.Effect<void, unknown> | undefined) => effect === undefined ? Effect.void : safe(effect)

export interface NotificationHost {
  readonly notifier: Notifier
  /** Whether any topic has an unread mention, on every change. Main shows the dock badge. */
  readonly badge?: (mentions: boolean) => Effect.Effect<void>
}
export class NotificationControl extends Context.Service<NotificationControl, {
  readonly attach: (notifications: Notifications | undefined) => Effect.Effect<void>
  readonly wake: Effect.Effect<void>
  readonly setPresence: (presence: Presence) => Effect.Effect<void>
  readonly currentPresence: Effect.Effect<Presence | undefined>
  /** What Slack shows for the signed-in session, once known, then every change. */
  readonly presence: Stream.Stream<Presence | undefined>
}>()('juno/engine/NotificationControl') {
  static readonly layer = Layer.effect(NotificationControl, Effect.gen(function* () {
    const active = yield* SubscriptionRef.make<Notifications | undefined>(undefined)
    const current = SubscriptionRef.get(active)
    const wake = Effect.flatMap(current, (notifications) => run(notifications?.wake))
    // Main says when the Mac wakes: apply the presence schedule again.
    const link = yield* HostLink
    const fromMain = yield* link.messages
    yield* Effect.forkScoped(Stream.runForEach(fromMain, (message) => message._tag === 'wake' ? wake : Effect.void))
    return NotificationControl.of({
      attach: (next) => SubscriptionRef.set(active, next),
      wake,
      setPresence: (value) => Effect.flatMap(current, (notifications) => run(notifications?.setPresence(value))),
      currentPresence: Effect.flatMap(current, (notifications) => notifications?.currentPresence ?? Effect.succeed(undefined)),
      presence: SubscriptionRef.changes(active).pipe(
        Stream.switchMap((notifications) => notifications === undefined ? Stream.make(undefined) : notifications.presenceChanges),
        Stream.changes,
      ),
    })
  }))
}

/** Main supplies delivery and focused-topic state; an absent host shows nothing. */
export const NotificationHost = Context.Reference<NotificationHost>('juno/engine/NotificationHost', {
  defaultValue: () => ({ notifier: {
    show: () => Effect.void,
    summary: ({ id }) => Effect.succeed(id),
    viewing: () => Effect.succeed(false),
  } }),
})

/**
 * The host for the Electron engine: notifications go to main over the host
 * link, and main says which topic is on screen in a focused window. The
 * Juno chat cannot take the hours-start summary yet (WP14), so the summary
 * keeps its first message for the click, and its id stands in for the chat
 * message.
 */
export const hostNotificationHost = Layer.effect(NotificationHost, Effect.gen(function* () {
  const link = yield* HostLink
  const viewing = yield* Ref.make<string | null>(null)
  const firstOf = new Map<string, NotificationSource>()
  const messages = yield* link.messages
  yield* Effect.forkScoped(Stream.runForEach(messages, (message) => message._tag === 'viewing' ? Ref.set(viewing, message.topicId) : Effect.void))
  const host: NotificationHost = {
    notifier: {
      show: ({ id, title, body, target }) => Effect.gen(function* () {
        let to: NotificationTarget
        if (target.kind === 'message') to = { _tag: 'message', source: target.source }
        else {
          const first = firstOf.get(target.id)
          if (first === undefined) return
          firstOf.delete(target.id)
          to = { _tag: 'summary', id: target.id, first }
        }
        yield* link.send({ _tag: 'notify', notification: { id, title, body, target: to } })
      }),
      summary: ({ id, sources }) => Effect.sync(() => {
        const first = sources[0]
        if (first !== undefined) firstOf.set(id, first)
        return id
      }),
      viewing: (topicId) => Effect.map(Ref.get(viewing), (shown) => shown === topicId),
    },
    badge: (mentions) => link.send({ _tag: 'badge', mentions }),
  }
  return host
}))

type Frame = Extract<SocketEvent, { readonly _tag: 'Frame' }>['frame']

/** Runs inside the session scope and shares its store and Slack client. */
export const startNotifications = Effect.gen(function* () {
  const api = yield* SlackApi
  const session = yield* SlackSession
  const sql = yield* StoreReader
  const host = yield* NotificationHost
  const control = yield* NotificationControl
  const notifier: Notifier = {
    viewing: host.notifier.viewing,
    show: (notification) => host.notifier.show({ ...notification, id: `${session.teamId}:${notification.id}` }),
    summary: (summary) => host.notifier.summary({ ...summary, id: `${session.teamId}:${summary.id}` }),
  }
  const notifications = yield* makeNotifications(notifier, (presence) => api.call('presence.set', { presence }, { lane: 'send' }).pipe(
    Effect.as(true), Effect.catch(() => Effect.succeed(false)),
  ))
  yield* Effect.acquireRelease(control.attach(notifications), () => control.attach(undefined))
  const queue = yield* Queue.unbounded<{ readonly frame: Frame; readonly me: Me }>()
  const handle = Effect.fn('Notifications.frame')(function* ({ frame, me }: { readonly frame: Frame; readonly me: Me }) {
    if (frame.type === 'manual_presence_change') {
      if (frame.user === undefined || frame.user === session.userId) yield* notifications.observePresence(frame.presence)
      return
    }
    if (frame.type !== 'message' && frame.type !== 'desktop_notification') return
    if (frame.type === 'message' && ('message' in frame || 'deleted_ts' in frame || !('ts' in frame))) return
    if (!('channel' in frame) || frame.channel === undefined) return
    const ts = frame.type === 'desktop_notification' ? frame.msg ?? frame.ts : frame.ts
    if (ts === undefined) return
    const user = 'user' in frame ? frame.user : undefined
    if (user === session.userId) return
    const text = frame.type === 'desktop_notification' ? frame.content : ('text' in frame ? frame.text ?? '' : '')
    const body = messageBody(frame.type === 'desktop_notification' ? { text } : frame)
    const mentionsMe = messageMentionsMe(body, me)
    const conversations = yield* sql<ConversationRow & { ignored: number; person_name: string | null; sender_name: string | null }>`SELECT c.*, ig.channel IS NOT NULL AS ignored,
      COALESCE(u.display_name, u.real_name, u.name) AS person_name,
      COALESCE(sender.display_name, sender.real_name, sender.name) AS sender_name FROM conversations c
      LEFT JOIN ignored_channels ig ON ig.channel = c.id LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users sender ON sender.id = ${user ?? ''} WHERE c.id = ${frame.channel}`
    const channel = conversations[0]
    if (channel === undefined) return
    const threadTs = 'thread_ts' in frame ? frame.thread_ts : undefined
    const topicId = threadTs === undefined || threadTs === ts ? `m:${channel.id}` : `t:${channel.id}:${threadTs}`
    if (frame.type === 'message' && !mentionsMe && !isDm(channel.kind)) {
      const { settings } = yield* readSettings
      if (settings.channels[channel.id] !== 'every' && settings.people[user ?? ''] !== 'every' && settings.threads?.[topicId] !== 'every') return
    }
    yield* notifications.receive({ channel: { id: ChannelId.make(channel.id), kind: channel.kind,
      name: channel.person_name ?? channel.name ?? channel.id, ignored: channel.ignored === 1 },
      senderId: UserId.make(user ?? ''), ...(channel.sender_name === null ? {} : { senderName: channel.sender_name }), mentionsMe, ts, text: plainText(body),
      topicId })
  })
  yield* Effect.forkScoped(Stream.runForEach(Stream.fromQueue(queue), (event) => safe(handle(event))))
  // Re-read persisted preferences only when they change. The initial pass also catches missed starts.
  let last: string | undefined
  yield* Effect.forkScoped(Stream.runForEach(liveQuery(['prefs'], Effect.gen(function* () {
    const rows = yield* sql<{ key: string; value_json: string }>`SELECT key, value_json FROM prefs WHERE key IN ('notifications', 'aiAssist') ORDER BY key`
    return JSON.stringify(rows)
  })), (result) => {
    if (result._tag === 'Failure' || result.success === last) return Effect.void
    last = result.success
    return safe(notifications.settingsChanged)
  }))
  // The dock badge: any unread topic that mentions you, outside ignored channels. The partial unread index bounds the read.
  const badge = host.badge
  if (badge !== undefined) {
    let shown: boolean | undefined
    yield* Effect.forkScoped(Stream.runForEach(liveQuery(['topics', 'ignored_channels'], Effect.gen(function* () {
      const rows = yield* sql<{ id: string }>`SELECT topic_id AS id FROM topic_index INDEXED BY topic_index_unread
        WHERE unread_count > 0 AND mentions_me = 1 AND channel NOT IN (SELECT channel FROM ignored_channels) LIMIT 1`
      return rows.length > 0
    })), (result) => {
      if (result._tag === 'Failure' || result.success === shown) return Effect.void
      shown = result.success
      return badge(result.success)
    }))
    yield* Effect.addFinalizer(() => shown === true ? badge(false) : Effect.void)
  }
  yield* Effect.forkScoped(Effect.gen(function* () {
    yield* safe(notifications.tick)
    while (true) {
      // Align to minute boundaries; schedule fields have minute resolution. Wake is explicit.
      const now = yield* Clock.currentTimeMillis
      yield* Effect.sleep(60_000 - now % 60_000)
      yield* safe(notifications.tick)
    }
  }))
  return (event: SocketEvent, me: Me) => event._tag === 'Frame' ? Queue.offer(queue, { frame: event.frame, me }).pipe(Effect.asVoid) : Effect.void
})
