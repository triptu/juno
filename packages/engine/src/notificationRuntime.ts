/** Shared session composition and host seam for the notifications feature. */
import { ChannelId, UserId, isDm, messageMentionsMe, messageMentionsMeDirectly, type Me, type Presence } from '@juno/domain'
import { makeNotifications, readSettings, type Notifier, type Notifications } from '@juno/notifications'
import { AiProvider } from '@juno/ai'
import { messageBody, readableText, UNKNOWN_PERSON } from '@juno/richtext'
import { SlackApi, SlackSession, type SocketEvent } from '@juno/slack'
import { Invalidation, liveQuery, StoreReader, type ConversationRow } from '@juno/store'
import { Clock, Context, Effect, Layer, Ref, Stream, SubscriptionRef } from 'effect'
import { conversationLabel } from './placeLabel'
import { startDockBadge } from './dockBadge'
import { HostLink } from './protocol/host'
import { SocketEvents, type SessionStart, type SocketInput } from './socketEvents'

const safe = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.catch(() => Effect.logWarning('notifications: operation failed')))
const run = (effect: Effect.Effect<void, unknown> | undefined) => effect === undefined ? Effect.void : safe(effect)

export interface NotificationHost {
  readonly notifier: Notifier
  /** Unread DMs, group DMs and mentioned topics, on every change. Main shows the dock badge. */
  readonly badge?: (unread: boolean) => Effect.Effect<void>
}

export class NotificationControl extends Context.Service<NotificationControl, {
  readonly attach: (notifications: Notifications | undefined) => Effect.Effect<void>
  readonly wake: Effect.Effect<void>
  /** Set yourself away or active. Whether Slack took it; false while signed out. */
  readonly setPresence: (presence: Presence) => Effect.Effect<boolean>
  /** Slack's presence for the user as the boot read it (`runSync`'s `onSelfPresence`). */
  readonly seedPresence: (presence: Presence) => Effect.Effect<void>
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
    const control = NotificationControl.of({
      attach: (next) => SubscriptionRef.set(active, next),
      wake,
      setPresence: (value) => Effect.flatMap(current, (notifications) => notifications === undefined ? Effect.succeed(false) : notifications.setPresence(value).pipe(
        Effect.catch(() => Effect.as(Effect.logWarning('notifications: presence not set'), false)),
      )),
      seedPresence: (value) => Effect.flatMap(current, (notifications) => run(notifications?.seedPresence(value))),
      currentPresence: Effect.flatMap(current, (notifications) => notifications?.currentPresence ?? Effect.succeed(undefined)),
      presence: SubscriptionRef.changes(active).pipe(
        Stream.switchMap((notifications) => notifications === undefined ? Stream.make(undefined) : notifications.presenceChanges),
        Stream.changes,
      ),
    })
    const host = yield* NotificationHost
    const ai = yield* AiProvider
    const events = yield* SocketEvents
    yield* events.subscribe('notifications', sessionNotifications(control, host, ai))
    return control
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
  const lastBadge = yield* Ref.make(false)
  const messages = yield* link.messages
  yield* Effect.forkScoped(Stream.runForEach(messages, (message) => message._tag === 'viewing' ? Ref.set(viewing, message.topicId) : message._tag === 'wake' ? Effect.flatMap(Ref.get(lastBadge), (unread) => link.send({ _tag: 'badge', unread })) : Effect.void))
  const host: NotificationHost = {
    notifier: {
      show: ({ id, title, body, target }) => link.send({ _tag: 'notify', notification: { id, title, body, target: { _tag: 'message', source: target.source } } }),
      viewing: (topicId) => Effect.map(Ref.get(viewing), (shown) => shown === topicId),
    },
    badge: (unread) => Ref.set(lastBadge, unread).pipe(Effect.andThen(link.send({ _tag: 'badge', unread }))),
  }
  return host
}))

type Frame = Extract<SocketEvent, { readonly _tag: 'Frame' }>['frame']

/** Turns one stored frame into a notification candidate, or a presence change of the user's own. */
const frameHandler = (userId: string, sql: StoreReader['Service'], notifications: Notifications) => Effect.fn('Notifications.frame')(function* ({ frame, me }: { readonly frame: Frame; readonly me: Me }) {
  if (frame.type === 'manual_presence_change') {
    if (frame.user === undefined || frame.user === userId) yield* notifications.observePresence(frame.presence)
    return
  }
  if (frame.type !== 'message' && frame.type !== 'desktop_notification') return
  if (frame.type === 'message' && ('message' in frame || 'deleted_ts' in frame || !('ts' in frame))) return
  // An ephemeral message (Slackbot's notes) never notifies, as in Slack's client.
  if (frame.type === 'message' && 'is_ephemeral' in frame && frame.is_ephemeral === true) return
  if (!('channel' in frame) || frame.channel === undefined) return
  const ts = frame.type === 'desktop_notification' ? frame.msg ?? frame.ts : frame.ts
  if (ts === undefined) return
  const user = 'user' in frame ? frame.user : undefined
  if (user === userId) return
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
    const always = settings.channels[channel.id] === 'always' || settings.people[user ?? ''] === 'always' || settings.threads?.[topicId] === 'always'
    // A reply in a thread the owner follows or started is decided too, whether or not Slack also sends desktop_notification; (channel, ts) keeps one row.
    const owned = !always && topicId.startsWith('t:') && (yield* sql`SELECT 1 FROM thread_subs WHERE channel = ${channel.id} AND thread_ts = ${threadTs ?? ''} AND subscribed = 1
      UNION ALL SELECT 1 FROM started_threads WHERE channel = ${channel.id} AND root_ts = ${threadTs ?? ''} LIMIT 1`).length > 0
    if (!always && !owned) return
  }
  // A group DM is named by its people, as the sidebar names it, not by Slack's "mpdm-…" name.
  const groupName = channel.kind === 'mpim' ? (yield* conversationLabel(channel.id))?.label : undefined
  yield* notifications.receive({ channel: { id: ChannelId.make(channel.id), kind: channel.kind,
    name: groupName ?? channel.person_name ?? channel.name ?? (channel.kind === 'im' ? UNKNOWN_PERSON : channel.id), ignored: channel.ignored === 1 },
    senderId: UserId.make(user ?? ''), ...(channel.sender_name === null ? {} : { senderName: channel.sender_name }), mentionsMe, mentionsMeDirectly,
    mentionsOthers: [...mentioned].filter((id) => id !== userId && id !== user).flatMap((id) => names.get(id) ?? []), ts, text: readableText(body),
    topicId })
})

/** Runs for each sync, in its scope, and shares its store and Slack client. */
const sessionNotifications = (control: NotificationControl['Service'], host: NotificationHost, ai: AiProvider['Service']): SessionStart => Effect.gen(function* () {
  const api = yield* SlackApi
  const session = yield* SlackSession
  const sql = yield* StoreReader
  const notifier: Notifier = {
    viewing: host.notifier.viewing,
    show: (notification) => host.notifier.show({ ...notification, id: `${session.teamId}:${notification.id}` }),
  }
  const notifications = yield* makeNotifications(notifier, (presence) => api.call('presence.set', { presence }, { lane: 'send' }).pipe(
    Effect.as(true), Effect.catch(() => Effect.succeed(false)),
  ), session.userId)
  yield* Effect.acquireRelease(control.attach(notifications), () => control.attach(undefined))
  const handle = frameHandler(session.userId, sql, notifications)
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
  if (host.badge !== undefined) yield* startDockBadge(host.badge, session.userId)
  yield* Effect.forkScoped(Effect.gen(function* () {
    yield* safe(notifications.tick)
    while (true) {
      // Align to minute boundaries; schedule fields have minute resolution. Wake is explicit.
      const now = yield* Clock.currentTimeMillis
      yield* Effect.sleep(60_000 - now % 60_000)
      yield* safe(notifications.tick)
      yield* Invalidation.use((invalidation) => invalidation.invalidate(['badge_clock']))
    }
  }))
  // `SocketEvents` calls this after the sync wrote the event, one event at a time, so the message's channel and people are in the store.
  // After `Overflowed` the frames it replaced go unnotified; `SocketEvents` logged them.
  return (input: SocketInput, me: Me) => input._tag === 'Frame' ? safe(handle({ frame: input.frame, me })).pipe(Effect.provideService(StoreReader, sql)) : Effect.void
}).pipe(Effect.provideService(AiProvider, ai))
