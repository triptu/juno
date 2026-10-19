/**
 * Leaving a huddle the user is alone in (SPEC 20, "The only one left"):
 * after 10 minutes as the only person in the call, Juno leaves, as Slack
 * does. The time counts from when the call was live with nobody else in
 * it, and starts again when anyone joins.
 */

export const ALONE_LEAVE_MILLIS = 10 * 60_000

/** The user is alone in the call of `attendeeId`, since `since` (epoch milliseconds). */
export interface Alone {
  readonly attendeeId: string
  readonly since: number
}

export interface CallNow {
  /** The current call's attendee, if any. */
  readonly attendeeId: string | undefined
  /** Its media is up (connected or reconnecting). */
  readonly live: boolean
  /** User ids in the huddle, the user included. */
  readonly participants: ReadonlyArray<string>
}

/** Whether the user is alone now, keeping the earlier start while they stay alone in the same call. */
export const aloneNow = (before: Alone | undefined, call: CallNow, now: number): Alone | undefined => {
  if (call.attendeeId === undefined || !call.live || new Set(call.participants).size > 1) return undefined
  return before?.attendeeId === call.attendeeId ? before : { attendeeId: call.attendeeId, since: now }
}

/** When Juno leaves a call it is alone in. */
export const leaveAt = (alone: Alone, millis = ALONE_LEAVE_MILLIS): number => alone.since + millis
