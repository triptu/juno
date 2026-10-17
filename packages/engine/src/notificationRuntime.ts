/** Shared session composition and host seam for the notifications feature. */
import { ChannelId, UserId, isDm, messageMentionsMe, messageMentionsMeDirectly, type Me, type Presence } from '@juno/domain'
import { makeNotifications, readSettings, type Notifier, type Notifications } from '@juno/notifications'
import { messageBody, plainText, UNKNOWN_PERSON } from '@juno/richtext'
import { SlackApi, SlackSession, type SocketEvent } from '@juno/slack'
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
    viewing: () => Effect.succeed(false),
  } }),
})

export const hostNotificationHost = Layer.effect(NotificationHost, Effect.gen(function* () {
  const link = yield* HostLink
  const viewing = yield* Ref.make<string | null>(null)
  const messages = yield* link.messages
  yield* Effect.forkScoped(Stream.runForEach(messages, (message) => message._tag === 'viewing' ? Ref.set(viewing, message.topicId) : Effect.void))
  const host: NotificationHost = {
    notifier: {
      show: ({ id, title, body, target }) => link.send({ _tag: 'notify', notification: { id, title, body, target: { _tag: 'message', source: target.source } } }),
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
    // The people the message mentions, by name: the notification's text never shows an id.
    const mentioned = new Set([...`${text} ${'blocks' in frame ? JSON.stringify(frame.blocks ?? []) : ''}`.matchAll(/<@([UW][A-Z0-9]+)|"user_id":"([UW][A-Z0-9]+)"/g)].map((m) => (m[1] ?? m[2])!))
    const names = new Map<string, string>()
    if (mentioned.size > 0) {
      for (const row of yield* sql<{ id: string; name: string | null }>`SELECT id, COALESCE(display_name, real_name, name) AS name FROM users WHERE id IN ${sql.in([...mentioned])}`) {
        if (row.name !== null) names.set(row.id, row.name)
      }
    }
    // And the groups, by handle.
    const groupIds = new Set([...`${text} ${'blocks' in frame ? JSON.stringify(frame.blocks ?? []) : ''}`.matchAll(/<!subteam\^([A-Z0-9]+)|"usergroup_id":"([A-Z0-9]+)"/g)].map((m) => (m[1] ?? m[2])!))
    const groups = new Map<string, { readonly handle: string }>()
    if (groupIds.size > 0) {
      for (const row of yield* sql<{ id: string; handle: string }>`SELECT id, handle FROM usergroups WHERE id IN ${sql.in([...groupIds])}`) groups.set(row.id, { handle: row.handle })
    }
    const body = messageBody(frame.type === 'desktop_notification' ? { text } : frame, { user: (id) => names.get(id), usergroup: (id) => groups.get(id) })
    const mentionsMe = messageMentionsMe(body, me)
    const mentionsMeDirectly = mentionsMe && messageMentionsMeDirectly(body, me)
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
      name: channel.person_name ?? channel.name ?? (channel.kind === 'im' ? UNKNOWN_PERSON : channel.id), ignored: channel.ignored === 1 },
      senderId: UserId.make(user ?? ''), ...(channel.sender_name === null ? {} : { senderName: channel.sender_name }), mentionsMe, mentionsMeDirectly, ts, text: plainText(body),
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
  return {
    onEvent: (event: SocketEvent, me: Me) => event._tag === 'Frame' ? Queue.offer(queue, { frame: event.frame, me }).pipe(Effect.asVoid) : Effect.void,
    /** Slack's presence for the user as the boot read it. */
    onSelfPresence: (presence: Presence) => notifications.seedPresence(presence),
  }
})
