/**
 * Huddles: `rooms.join`, `rooms.leave`, the edge `huddles/info` and the
 * `sh_room_*` socket frames.
 *
 * Source: docs/research/slack-huddles.md sections 2 and 6. Only the fields
 * the client reads are typed. The Chime `meeting` and `attendee` objects
 * keep every key, since they go to the Chime SDK as they are.
 *
 * Times: `date_start` and `start_date` are taken to be epoch seconds, as
 * Slack's other `date_*` fields are; the spike recorded names, not values.
 */
import { Schema as S } from 'effect'
import { FormBoolean, FormJson, FormList, RawObject } from './common.ts'

const opt = S.optionalKey

// rooms.join

export const RoomsJoinArgs = S.Struct({
  channel_id: S.String,
  /** The huddle's thread, for a huddle started in a thread. */
  thread_ts: opt(S.String),
  /** The nearest Chime media region, from `nearest-media-region.l.chime.aws`. */
  regions: opt(FormList),
  /** A room id, to join a known room. */
  id: opt(S.String),
  /** The official client always sends it, `false` unless joining from a second device. */
  multidevice: opt(FormBoolean),
})
export type RoomsJoinArgs = typeof RoomsJoinArgs.Type

/** Chime's own `Meeting` and `Attendee` (PascalCase), passed to `MeetingSessionConfiguration` as they are. */
export const FreeWilly = S.Struct({ meeting: RawObject, attendee: RawObject })
export type FreeWilly = typeof FreeWilly.Type

export const RoomsJoinCall = S.StructWithRest(
  S.Struct({
    call_id: S.String,
    /** Absent on the legacy calls-server answer. */
    free_willy: opt(FreeWilly),
  }),
  [RawObject],
)
export type RoomsJoinCall = typeof RoomsJoinCall.Type

/** The huddle the join answer describes. Other keys are dropped. */
export const RoomsJoinHuddle = S.Struct({
  id: opt(S.String),
  channels: opt(S.Array(S.String)),
  participants: opt(S.Array(S.String)),
  date_start: opt(S.Number),
  thread_root_ts: opt(S.String),
})
export type RoomsJoinHuddle = typeof RoomsJoinHuddle.Type

export const RoomsJoinFields = {
  call: RoomsJoinCall,
  huddle: opt(RoomsJoinHuddle),
  canvas: opt(RawObject),
} as const

// rooms.leave

export const RoomsLeaveArgs = S.Struct({
  channel_id: S.String,
  call_id: S.String,
  attendee_id: S.String,
  /** `user_initiated` for a user's leave, `unload` when sent as the page closes. */
  reason: opt(S.String),
})
export type RoomsLeaveArgs = typeof RoomsLeaveArgs.Type

export const RoomsLeaveFields = {} as const

// huddles/info (edge)

export const EdgeHuddlesInfoArgs = S.Struct({ channel_ids: S.Array(S.String) })
export type EdgeHuddlesInfoArgs = typeof EdgeHuddlesInfoArgs.Type

/** One running huddle. A channel with none is absent from the answer. */
export const HuddleInfo = S.Struct({
  call_id: S.String,
  channel_id: S.String,
  active_members: opt(S.Array(S.String)),
  start_date: opt(S.Number),
  thread_root_ts: opt(S.String),
})
export type HuddleInfo = typeof HuddleInfo.Type

export const EdgeHuddlesInfoOk = S.Struct({ ok: S.Literal(true), huddles: S.Array(HuddleInfo) })
export type EdgeHuddlesInfoOk = typeof EdgeHuddlesInfoOk.Type

// sh_room_join, sh_room_leave, sh_room_update

/**
 * The room as a room frame carries it: the whole room after the change,
 * so `participants` is everyone in it then. On the last leave it is empty.
 */
export const RoomFrameRoom = S.Struct({
  id: S.String,
  channels: opt(S.Array(S.String)),
  participants: opt(S.Array(S.String)),
  date_start: opt(S.Number),
  has_ended: opt(S.Boolean),
  thread_root_ts: opt(S.String),
})
export type RoomFrameRoom = typeof RoomFrameRoom.Type

/**
 * A room frame. `RtmFrame` passes these through as `{ type: 'unknown', raw }`;
 * `@juno/huddle` decodes `raw` with this. `user` is who joined or left: a
 * user id, never a Chime attendee id.
 */
export const ShRoomFrame = S.Struct({
  type: S.Literals(['sh_room_join', 'sh_room_leave', 'sh_room_update']),
  user: opt(S.String),
  huddle: opt(S.Struct({ channel_id: S.String })),
  room: RoomFrameRoom,
  event_ts: opt(S.String),
})
export type ShRoomFrame = typeof ShRoomFrame.Type

// users.profile.set, for the "In a huddle" status only

/**
 * The one profile field the official client writes while a huddle runs
 * (`increment-huddle-state-expiration-ts`): epoch seconds, fractional, now
 * plus 300. `huddle_state` and `huddle_state_channel_id` are never written
 * by the client. Juno sends no other profile field.
 */
export const HuddleStatusProfile = S.Struct({ huddle_state_expiration_ts: S.Number })
export type HuddleStatusProfile = typeof HuddleStatusProfile.Type

/** `profile` is one JSON-encoded form field, as the official client's `JSON.stringify(profile)`. */
export const UsersProfileSetArgs = S.Struct({ profile: FormJson(HuddleStatusProfile) })
export type UsersProfileSetArgs = typeof UsersProfileSetArgs.Type

/** The answer's profile is never read. */
export const UsersProfileSetFields = {} as const
