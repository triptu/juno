/** Indexed badge existence query. Settings compile to a finite decision table through the domain rule. */
import { dockBadgeActive, localTime, type BadgeContext, type NotificationSettings, type NotifyLevel } from '@juno/domain'
import { Clock, Effect, Stream } from 'effect'
import { liveQuery, StoreReader } from '@juno/store'
import { readSettings } from '@juno/notifications'
import { IN_ALL, unreadFrom } from './sidebarUnread'

const levels: ReadonlyArray<NotifyLevel | undefined> = [undefined, 'always', 'never']

/** The SQL encodes inputs, never notification precedence. The domain evaluates each possible input once per settings/time change. */
export function badgePolicy(settings: NotificationSettings, context: BadgeContext) {
  const allowed: number[] = []
  for (let thread = 0; thread < 3; thread++) for (let channel = 0; channel < 3; channel++) for (let person = 0; person < 3; person++) {
    for (let dm = 0; dm < 2; dm++) for (let mention = 0; mention < 3; mention++) for (let visible = 0; visible < 2; visible++) {
      for (let ignored = 0; ignored < 2; ignored++) for (let judgement = 0; judgement < 3; judgement++) {
        const config: NotificationSettings = { ...settings, channels: channel === 0 ? {} : { C: levels[channel]! }, people: person === 0 ? {} : { U: levels[person]! }, threads: thread === 0 ? {} : { 't:C:1': levels[thread]! } }
        const active = dockBadgeActive([{
          id: 't:C:1', channel: 'C', kind: dm === 1 ? 'im' : 'public', person: 'U', mentionsMe: mention > 0,
          mentionsMeDirectly: mention === 2, sidebarVisible: visible === 1, ignored: ignored === 1,
          ...(judgement === 0 ? {} : { auto: judgement === 2 }),
        }], config, context)
        if (active) allowed.push(thread + channel * 3 + person * 9 + dm * 27 + mention * 54 + visible * 162 + ignored * 324 + judgement * 648)
      }
    }
  }
  return { allowed, settings: JSON.stringify(settings), unknownSender: !Object.values(settings.people).includes('never') }
}

const level = (path: string) => `CASE json_extract(?, ${path}) WHEN 'always' THEN 1 WHEN 'never' THEN 2 ELSE 0 END`
const threadLevel = level(`'$.threads."' || i.topic_id || '"'`)
const channelLevel = level(`'$.channels."' || i.channel || '"'`)
const personLevel = (sender: string) => level(`'$.people."' || COALESCE(${sender}, '') || '"'`)
/** What Auto decided for a logged message: 0 not read, 1 stay, 2 notify. */
const AUTO = `CASE WHEN n.decided_by IN ('closer', 'addressedElsewhere', 'live', 'instruction', 'reading') THEN CASE n.outcome WHEN 'notify' THEN 2 ELSE 1 END ELSE 0 END`
const knownRead = `(r.observed_at IS NOT NULL OR r.last_read_ts IS NOT NULL OR (i.kind = 'main' AND cr.counts_updated IS NOT NULL) OR (i.kind = 'thread' AND s.slack_last_read IS NOT NULL))`

export function badgeStatement(policy: ReturnType<typeof badgePolicy>, self: string) {
  const accepted = policy.allowed.length === 0 ? 'NULL' : policy.allowed.join(',')
  const code = (sender: string, mention: string, judgement: string) => `(${threadLevel} + 3 * ${channelLevel} + 9 * ${personLevel(sender)}
    + 27 * (c.kind IN ('im', 'mpim')) + 54 * (${mention}) + 162 * (${IN_ALL}) + 324 * (ig.channel IS NOT NULL) + 648 * (${judgement})) IN (${accepted})`
  const params = [policy.settings, policy.settings, policy.settings]
  return {
    sql: `SELECT EXISTS(SELECT 1 ${unreadFrom(true, 'LEFT JOIN topic_reads r ON r.topic_id = i.topic_id LEFT JOIN channel_reads cr ON cr.channel = i.channel')} AND ${knownRead} AND (
      EXISTS(SELECT 1 FROM messages m LEFT JOIN notification_log n ON n.channel = m.channel AND n.ts = m.ts
        WHERE m.channel = i.channel AND (m.ts > COALESCE(r.last_read_ts, CASE WHEN i.kind = 'main' THEN cr.slack_last_read ELSE s.slack_last_read END, '0') OR (r.marked_unread = 1 AND m.ts = i.last_activity_ts)) AND m.deleted = 0 AND m.ephemeral = 0 AND COALESCE(m.user_id, '') <> ?
          AND ((i.kind = 'main' AND (m.thread_ts IS NULL OR m.thread_ts = m.ts OR m.subtype = 'thread_broadcast')) OR (i.kind = 'thread' AND (m.thread_ts = i.root_ts OR m.ts = i.root_ts)))
          AND ${code('m.user_id', 'm.attention', AUTO)} LIMIT 1)
      OR ((i.message_count = 0 OR (r.marked_unread = 1 AND c.kind IN ('im', 'mpim'))) AND (c.kind = 'im' OR ${policy.unknownSender ? '1' : '0'}) AND ${code('c.user_id', 'CASE WHEN i.mentions_me = 1 THEN 2 ELSE 0 END', '0')})
    ) LIMIT 1) AS active`,
    params: [self, ...params, ...params],
  }
}

/** Settings are read only on prefs invalidation; the compiled decision table is retained for the current minute. */
export const startDockBadge = (send: (active: boolean) => Effect.Effect<void>, self: string) => Effect.gen(function* () {
  const sql = yield* StoreReader
  let shown: boolean | undefined
  const changes = liveQuery(['prefs'], readSettings).pipe(Stream.switchMap((configuration) => {
    if (configuration._tag === 'Failure') return Stream.empty
    let minute: number | undefined
    let policy: ReturnType<typeof badgePolicy>
    return liveQuery(['topics', 'messages', 'topic_reads', 'channel_reads', 'ignored_channels', 'conversations', 'topic_overlay', 'thread_subs', 'sidebar_views', 'automated_holds', 'notification_log', 'badge_clock'], Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      if (minute !== Math.floor(now / 60_000)) {
        minute = Math.floor(now / 60_000)
        policy = badgePolicy(configuration.success.settings, { aiAssist: configuration.success.aiAssist, at: localTime(now) })
      }
      const statement = badgeStatement(policy!, self)
      return (yield* sql.unsafe<{ active: number }>(statement.sql, statement.params))[0]?.active === 1
    }))
  }))
  yield* Effect.forkScoped(Stream.runForEach(changes, (result) => {
    if (result._tag === 'Failure' || result.success === shown) return Effect.void
    shown = result.success
    return send(result.success)
  }))
  yield* Effect.addFinalizer(() => send(false))
})
