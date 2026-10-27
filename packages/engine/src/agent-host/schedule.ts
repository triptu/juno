import { Context, Effect, Result, Schema, Stream } from 'effect'
import { AgentHostError, WatchSnapshot, type WatchConversation } from '@juno/agent-contract'
import { StoreReader, liveQuery } from '@juno/store'
import { readSettings } from '@juno/notifications'
import type { Hours } from '@juno/domain'
import type { Workspace } from '../workspace'

export const watchSnapshot = (conversation: typeof WatchConversation.Type) => Effect.gen(function* () {
  const sql = yield* StoreReader
  const [team] = yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`
  if (team?.self_user_id == null) return yield* new AgentHostError({ reason: 'signedOut', message: 'Juno is signed out of Slack.' })
  const [source] = yield* sql<{ user_id: string | null; thread_ts: string | null }>`SELECT user_id, thread_ts FROM messages WHERE channel = ${conversation.channelId} AND ts = ${conversation.ts} AND deleted = 0`
  const messages = yield* sql.unsafe<{ channelId: string; ts: string; threadTs: string | null; userId: string }>(
    `SELECT channel AS channelId, ts, thread_ts AS threadTs, user_id AS userId FROM messages
     WHERE channel = ? AND ts > ? AND deleted = 0 AND user_id IS NOT NULL AND
     ${conversation.threadTs === undefined ? '(thread_ts IS NULL OR thread_ts = ts)' : 'thread_ts = ?'}`,
    [conversation.channelId, conversation.ts, ...(conversation.threadTs === undefined ? [] : [conversation.threadTs])],
  )
  return Schema.decodeUnknownSync(WatchSnapshot)({ owner: team.self_user_id, ownMessage: source?.user_id === team.self_user_id && (conversation.threadTs === undefined ? source.thread_ts === null || source.thread_ts === conversation.ts : conversation.threadTs === source.thread_ts || conversation.threadTs === conversation.ts),
    messages: messages.map((row) => ({ channelId: row.channelId, ts: row.ts, userId: row.userId, ...(row.threadTs === null || row.threadTs === row.ts ? {} : { threadTs: row.threadTs }) })),
  })
})
const isoWeekday = (day: number) => (day === 0 ? 7 : day)
/** No notification hours pause nothing: every day, as long as one day's hours can be. */
const anyTime: Hours = { days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 23 * 60 + 59 }
export const watchHours = Effect.map(readSettings, ({ settings: { notificationHours: hours = anyTime } }) => ({
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  weekdays: hours.days.map(isoWeekday),
  start: hours.from, end: hours.to,
  ...(hours.dayHours === undefined ? {} : { dayHours: hours.dayHours.map(({ day, from, to }) => ({ weekday: isoWeekday(day), start: from, end: to })) }),
}))
export const watchChanges = (workspace: Context.Service.Shape<typeof Workspace>) => workspace.changes.pipe(
  Stream.switchMap((open) => open === undefined ? Stream.make(undefined) : liveQuery(['messages'], Effect.void).pipe(
    Stream.filter((result) => Result.isSuccess(result)), Stream.map(() => undefined), Stream.provide(open.context),
  )),
)
