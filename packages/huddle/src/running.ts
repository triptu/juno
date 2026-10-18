/**
 * Running huddles per channel, from room frames and `huddles/info`.
 *
 * A room frame carries the whole room after the change, so it replaces
 * the channel's entry, unless it is stale: from a huddle that started
 * before the one shown, or no newer than the last frame applied for the
 * same huddle. A frame never touches the current call (specs/huddle.qnt,
 * `noStaleLeave`): its `user` is a Slack user, not a Chime attendee.
 *
 * Each frame also makes its channel due for a `huddles/info` read, which
 * is what the list converges on; the frame only shows the change sooner.
 */
import { Option, Schema } from 'effect'
import { ShRoomFrame, type HuddleInfo, type RoomsJoinHuddle } from '@juno/slack-schema'
import type { RunningHuddle, RunningHuddles } from '@juno/contract'

/** A room frame as the service uses it. */
export interface RoomFrame {
  readonly channelId: string
  readonly roomId: string
  readonly participants: ReadonlyArray<string>
  readonly ended: boolean
  /** Epoch milliseconds, when the frame says. */
  readonly startedAt: number | undefined
  readonly threadTs: string | undefined
  readonly eventTs: string | undefined
}

export interface Entry extends RunningHuddle {
  /** The last applied frame's `event_ts`, for ordering frames of one huddle. */
  readonly eventTs: string | undefined
}

export type Running = ReadonlyMap<string, Entry>

const decodeShRoom = Schema.decodeUnknownOption(ShRoomFrame)

/**
 * The room frame in an unknown socket frame, if it is one. `RtmFrame` does
 * not know room frames, so they arrive as `{ type: 'unknown', raw }`.
 */
export function decodeRoomFrame(raw: unknown): RoomFrame | undefined {
  const frame = Option.getOrUndefined(decodeShRoom(raw))
  if (frame === undefined) return undefined
  const channelId = frame.huddle?.channel_id ?? frame.room.channels?.[0]
  if (channelId === undefined) return undefined
  const participants = frame.room.participants ?? []
  return {
    channelId,
    roomId: frame.room.id,
    participants,
    ended: frame.room.has_ended === true || participants.length === 0,
    startedAt: frame.room.date_start === undefined ? undefined : frame.room.date_start * 1000,
    threadTs: frame.room.thread_root_ts,
    eventTs: frame.event_ts,
  }
}

const tsAfter = (a: string, b: string) => Number(a) > Number(b)

/** Whether `frame` is older than what `entry` shows. */
export function isStale(entry: Entry | undefined, frame: RoomFrame): boolean {
  if (entry === undefined) return false
  if (frame.startedAt !== undefined && entry.startedAt !== null && frame.startedAt < entry.startedAt) return true
  const sameHuddle = entry.callId === frame.roomId
  return sameHuddle && frame.eventTs !== undefined && entry.eventTs !== undefined && !tsAfter(frame.eventTs, entry.eventTs)
}

/** The running list after a room frame. A stale frame changes nothing. */
export function applyRoomFrame(running: Running, frame: RoomFrame): Running {
  const entry = running.get(frame.channelId)
  if (isStale(entry, frame)) return running
  const next = new Map(running)
  if (frame.ended) next.delete(frame.channelId)
  else
    next.set(frame.channelId, {
      callId: frame.roomId,
      participants: frame.participants,
      startedAt: frame.startedAt ?? (entry?.callId === frame.roomId ? entry.startedAt : null),
      threadTs: frame.threadTs ?? (entry?.callId === frame.roomId ? entry.threadTs : null),
      eventTs: frame.eventTs,
    })
  return next
}

/** The running list after a `huddles/info` answer for `channels`: each one is set to what Slack said, or removed. */
export function applyInfo(running: Running, channels: Iterable<string>, huddles: ReadonlyArray<HuddleInfo>): Running {
  const byChannel = new Map(huddles.map((h) => [h.channel_id, h]))
  const next = new Map(running)
  for (const channel of channels) {
    const huddle = byChannel.get(channel)
    if (huddle === undefined) next.delete(channel)
    else
      next.set(channel, {
        callId: huddle.call_id,
        participants: huddle.active_members ?? [],
        startedAt: huddle.start_date === undefined ? null : huddle.start_date * 1000,
        threadTs: huddle.thread_root_ts ?? null,
        eventTs: undefined,
      })
  }
  return next
}

/** The user's own join, from the `rooms.join` answer, until a frame or a read says more. */
export function applyJoined(running: Running, channelId: string, callId: string, huddle: RoomsJoinHuddle | undefined): Running {
  if (huddle?.participants === undefined) return running
  const entry = running.get(channelId)
  return new Map(running).set(channelId, {
    callId,
    participants: huddle.participants,
    startedAt: huddle.date_start === undefined ? (entry?.startedAt ?? null) : huddle.date_start * 1000,
    threadTs: huddle.thread_root_ts ?? entry?.threadTs ?? null,
    eventTs: entry?.callId === callId ? entry.eventTs : undefined,
  })
}

/** The contract's value: one record keyed by channel id. */
export function toRunningHuddles(running: Running): RunningHuddles {
  const out: Record<string, RunningHuddle> = {}
  for (const [channel, { callId, participants, startedAt, threadTs }] of running) out[channel] = { callId, participants, startedAt, threadTs }
  return out
}
