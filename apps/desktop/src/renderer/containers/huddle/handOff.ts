/**
 * What the page does with the credentials `huddle.start` hands it, as the
 * engine's call moves (specs/huddle.qnt, `receive`). It starts the session
 * once the call names their attendee, and acknowledges them, held by
 * nothing, once the call has moved past that attendee: the engine then
 * clears its leave. It also says when the running session must stop: the
 * call no longer names it.
 *
 * The credentials and the call's values reach the page in no fixed order.
 * The engine hands credentials out only while their attendee is the call,
 * so a call that has named the attendee and no longer does has moved on;
 * one that has not named them yet comes from before the hand-off, and the
 * value naming them is on its way.
 */
import type { HuddleCall, HuddleCredentials } from '@juno/contract'

export interface HandOff {
  readonly attendeeId: string
  readonly credentials: HuddleCredentials
}

export interface PageHold {
  /** Credentials handed to this page that wait for the call. */
  readonly pending: HandOff | undefined
  /** The attendee the session runs for, from `join` until it ends. */
  readonly holding: string | null
  /** The attendee the page last received, as it reports to the engine. */
  readonly received: string | null
  /** The attendee the call last named. */
  readonly named: string | null
}

export interface PageMove {
  readonly next: PageHold
  /** Credentials to start the session with. */
  readonly start: HandOff | undefined
  /** The session runs for an attendee the call no longer names. */
  readonly leave: boolean
}

export const noHold: PageHold = { pending: undefined, holding: null, received: null, named: null }

/** The page's next state and what to do, for a value of `huddle.call`. */
export function moveWith(state: PageHold, call: HuddleCall): PageMove {
  const leave = state.holding !== null && call.attendeeId !== state.holding
  const named = call.attendeeId ?? state.named
  const { pending } = state
  if (pending === undefined) return { next: { ...state, named }, start: undefined, leave }
  if (call.attendeeId === pending.attendeeId && state.holding === null) {
    return { next: { pending: undefined, holding: pending.attendeeId, received: pending.attendeeId, named }, start: pending, leave }
  }
  // Moved past before it started: the page received it and holds nothing for it.
  const past = call.phase === 'idle' || (call.attendeeId !== null && call.attendeeId !== pending.attendeeId) || state.named === pending.attendeeId
  return { next: { ...state, pending: past ? undefined : pending, received: past ? pending.attendeeId : state.received, named }, start: undefined, leave }
}
