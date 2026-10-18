/**
 * Huddles: `rooms.join`, `rooms.leave` and the edge `huddles/info`.
 *
 * Source: docs/research/slack-huddles.md section 2. Only the fields the
 * client reads are typed. The Chime `meeting` and `attendee` objects keep
 * every key, since they go to the Chime SDK as they are. The full answer
 * of each method is not known yet; the spike (`scripts/huddle-live.ts`)
 * records its field names.
 */
import { Schema as S } from 'effect'
import { FormBoolean, FormList, RawObject } from './common.ts'

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

export const RoomsJoinFields = {
  call: RoomsJoinCall,
  huddle: opt(RawObject),
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

/** The answer's shape beyond `ok` is not known yet; every key is kept. */
export const EdgeHuddlesInfoOk = S.StructWithRest(S.Struct({ ok: S.Literal(true) }), [RawObject])
export type EdgeHuddlesInfoOk = typeof EdgeHuddlesInfoOk.Type
