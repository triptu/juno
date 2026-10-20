import { Clock, Effect, Option, Schema } from 'effect'
import { ShRoomFrame, type RoomFrameRoom } from '@juno/slack-schema'
import { Invalidation, StoreWriter } from '@juno/store'

const WEEK = 7 * 24 * 60 * 60_000

/** Room facts only become more complete: a stale page cannot undo a join, end or acknowledgement. */
export const writeHuddle = (channel: string, room: RoomFrameRoom, selfId: string, threadTs?: string) => Effect.gen(function* () {
  const sql = yield* StoreWriter
  const now = yield* Clock.currentTimeMillis
  const start = (room.date_start ?? 0) * 1000
  if (start <= 0 || Math.max(start, (room.date_end ?? 0) * 1000) < now - WEEK || start > now || room.created_by === undefined) return
  const joined = room.created_by === selfId || room.participants?.includes(selfId) === true || room.participant_history?.includes(selfId) === true
  const ended = room.has_ended === true && (room.date_end ?? 0) > 0 ? room.date_end! * 1000 : null
  yield* sql`INSERT INTO huddle_history (call_id, channel, started_by, started_at, ended_at, thread_ts, joined, history_known)
    VALUES (${room.id}, ${channel}, ${room.created_by}, ${start}, ${ended}, ${room.thread_root_ts ?? room.canvas_thread_ts ?? threadTs ?? null}, ${joined ? 1 : 0}, ${ended !== null && room.participant_history !== undefined ? 1 : 0})
    ON CONFLICT (call_id) DO UPDATE SET
      ended_at = COALESCE(huddle_history.ended_at, excluded.ended_at),
      thread_ts = COALESCE(excluded.thread_ts, huddle_history.thread_ts),
      joined = MAX(huddle_history.joined, excluded.joined),
      history_known = MAX(huddle_history.history_known, excluded.history_known)`
  if (joined) yield* sql`UPDATE huddle_history SET seen = 1 WHERE channel = ${channel} AND started_at <= ${start}`
  // A later join may have arrived before this older room's history page.
  yield* sql`UPDATE huddle_history SET seen = 1 WHERE call_id = ${room.id} AND EXISTS
    (SELECT 1 FROM huddle_history later WHERE later.channel = ${channel} AND later.joined = 1 AND later.started_at >= ${start})`
  yield* sql`DELETE FROM huddle_history WHERE COALESCE(ended_at, started_at) < ${now - WEEK}`
  yield* (yield* Invalidation).invalidate(['huddle_history'])
})

const decodeRoom = Schema.decodeUnknownOption(ShRoomFrame)

export const writeHuddleFrame = (raw: unknown, selfId: string) => Effect.gen(function* () {
  const frame = Option.getOrUndefined(decodeRoom(raw))
  const channel = frame?.huddle?.channel_id ?? frame?.room.channels?.[0]
  if (frame !== undefined && channel !== undefined) yield* writeHuddle(channel, frame.room, selfId)
})
