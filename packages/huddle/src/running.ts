/**
 * Running huddles per channel, from room frames and `huddles/info`.
 *
 * Identities and times, as the live check of 2026-10-19 found
 * (docs/research/slack-huddles.md section 6): a room frame's `room.id`, the
 * `call_id` of `rooms.join` and of `huddles/info` are the same id, and
 * `room.date_start` and `start_date` are epoch seconds. A time outside the
 * range of epoch seconds is not used.
 *
 * A room frame carries the whole room after the change, so it replaces its
 * channel's entry when it is about the huddle the entry shows and newer than
 * the last frame applied to it, or when the channel shows none. A frame
 * about another room is not merged: the frame's channel is read again from
 * `huddles/info`, as after every frame. A frame never touches the current
 * call (specs/huddle.qnt, `noStaleLeave`): its `user` is a Slack user, not a
 * Chime attendee.
 */
import { Option, Schema } from 'effect'
import { ShRoomFrame, type HuddleInfo, type RoomsJoinHuddle } from '@juno/slack-schema'
import type { RunningHuddle, RunningHuddles } from '@juno/contract'

/** A room frame as the service uses it. */
export interface RoomFrame {
  readonly channelId: string
  /** The room's id, which is its call id. */
  readonly roomId: string
  readonly participants: ReadonlyArray<string>
  readonly ended: boolean
  /** Epoch milliseconds, when the frame gives a usable time. */
  readonly startedAt: number | undefined
  readonly threadTs: string | undefined
  readonly eventTs: string | undefined
}

/** Epoch seconds as milliseconds, or null for anything that is not a plausible time in seconds. */
export function secondsToMillis(seconds: number | undefined): number | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 1e9 || seconds >= 1e10) return null
  return seconds * 1000
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
    startedAt: secondsToMillis(frame.room.date_start) ?? undefined,
    threadTs: frame.room.thread_root_ts,
    eventTs: frame.event_ts,
  }
}

const tsAfter = (a: string, b: string) => Number(a) > Number(b)

/** Whether `frame` may change `entry`: about the huddle it shows and newer than its last frame, or the channel shows none. */
export function applies(entry: Entry | undefined, frame: RoomFrame): boolean {
  if (entry === undefined) return true
  if (entry.callId !== frame.roomId) return false
  return frame.eventTs === undefined || entry.eventTs === undefined || tsAfter(frame.eventTs, entry.eventTs)
}

/** The running list after a room frame. A frame that does not apply changes nothing. */
export function applyRoomFrame(running: Running, frame: RoomFrame): Running {
  const entry = running.get(frame.channelId)
  if (!applies(entry, frame)) return running
  if (frame.ended) {
    if (entry === undefined) return running
    const next = new Map(running)
    next.delete(frame.channelId)
    return next
  }
  return new Map(running).set(frame.channelId, {
    callId: frame.roomId,
    participants: frame.participants,
    startedAt: frame.startedAt ?? entry?.startedAt ?? null,
    threadTs: frame.threadTs ?? entry?.threadTs ?? null,
    eventTs: frame.eventTs,
  })
}

/**
 * The running list after a `huddles/info` answer for `channels`: each one
 * is set to what Slack said, or removed. A huddle with nobody active is
 * ending (on arch v2 Slack lists it empty for a few seconds after the last
 * person leaves) and counts as not running.
 */
export function applyInfo(running: Running, channels: Iterable<string>, huddles: ReadonlyArray<HuddleInfo>): Running {
  const byChannel = new Map(huddles.map((h) => [h.channel_id, h]))
  const next = new Map(running)
  for (const channel of channels) {
    const huddle = byChannel.get(channel)
    const entry = running.get(channel)
    if (huddle === undefined || (huddle.active_members ?? []).length === 0) next.delete(channel)
    else
      next.set(channel, {
        callId: huddle.call_id,
        participants: huddle.active_members ?? [],
        startedAt: secondsToMillis(huddle.start_date),
        threadTs: huddle.thread_root_ts ?? null,
        // A frame of this huddle older than the last one applied stays out after a read.
        eventTs: entry?.callId === huddle.call_id ? entry.eventTs : undefined,
      })
  }
  return next
}

/** The user's own join, from the `rooms.join` answer, until a frame or a read says more. */
export function applyJoined(running: Running, channelId: string, callId: string, huddle: RoomsJoinHuddle | undefined): Running {
  if (huddle?.participants === undefined) return running
  const entry = running.get(channelId)
  const same = entry?.callId === callId
  // A frame of this huddle already applied is newer than the answer.
  if (same && entry.eventTs !== undefined) return running
  return new Map(running).set(channelId, {
    callId,
    participants: huddle.participants,
    startedAt: secondsToMillis(huddle.date_start) ?? (same ? entry.startedAt : null),
    threadTs: huddle.thread_root_ts ?? (same ? entry.threadTs : null),
    eventTs: same ? entry.eventTs : undefined,
  })
}

/** The contract's value: one record keyed by channel id. */
export function toRunningHuddles(running: Running): RunningHuddles {
  const out: Record<string, RunningHuddle> = {}
  for (const [channel, { callId, participants, startedAt, threadTs }] of running) out[channel] = { callId, participants, startedAt, threadTs }
  return out
}
