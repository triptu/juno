/**
 * The call's lifecycle for one user, as pure rules (specs/huddle.qnt).
 *
 * Each function is one action of the model, under the model's name, and
 * returns the next state. `Huddle` runs them one at a time under a lock and
 * does the I/O they call for: `rooms.join` once `canRequest`, `rooms.leave`
 * for `toSend`, the stored record's delete for `toClear`.
 *
 * Model variables and where they live here:
 * - `wanted`, `request`, `cancel`, `current`: the same names.
 * - `pending` (durable): `pending[].identity`, stored in the workspace's
 *   user.db. `unsent` is `!sent`, `stopped` is `stopped`, per record.
 * - `media`: the attendees the renderer may be running, which is every
 *   pending record not `stopped`; the current call's record among them.
 * - `otherDevice`, `quitting`: the same names.
 * - `phase`: derived for the UI by `phaseOf`.
 */
import type { HuddleEnd, HuddleMediaEnd, HuddlePhase } from '@juno/contract'

/** What `rooms.join` returned: enough to leave. The Chime credentials are not kept here. */
export interface Identity {
  readonly channelId: string
  readonly callId: string
  readonly attendeeId: string
}

/** A leave that must happen. `identity` is stored; `sent` and `stopped` are this process's knowledge. */
export interface Pending {
  readonly identity: Identity
  /** `rooms.leave` went out in this process. */
  readonly sent: boolean
  /** No media session runs for this attendee. */
  readonly stopped: boolean
}

export interface Intent {
  readonly channelId: string
  readonly region: string | null
  /** Ties the intent to the Start that asked for it, so its caller gets the answer. */
  readonly ticket: number
}

export interface Current {
  readonly identity: Identity
  /** The renderer said its media session started. */
  readonly started: boolean
}

export interface Lifecycle {
  /** A Start or Join not yet sent: it waits for the pending leaves. */
  readonly wanted: Intent | undefined
  /** The `rooms.join` in flight. Only one at a time. */
  readonly request: Intent | undefined
  /** The request in flight was replaced or left: its answer is cleaned up, never used. */
  readonly cancel: boolean
  readonly current: Current | undefined
  readonly pending: ReadonlyArray<Pending>
  /** Chime moved the user to another device. No join until a new Start or Join. */
  readonly otherDevice: boolean
  readonly quitting: boolean
  readonly muted: boolean
  readonly ended: HuddleEnd | undefined
}

export const initial: Lifecycle = {
  wanted: undefined,
  request: undefined,
  cancel: false,
  current: undefined,
  pending: [],
  otherDevice: false,
  quitting: false,
  muted: false,
  ended: undefined,
}

const sameAttendee = (a: string | undefined, b: string | undefined) => a !== undefined && a === b

/** The attendee whose media may run: the current call's. Every other attendee's session must stop. */
export const currentAttendee = (s: Lifecycle): string | undefined => s.current?.identity.attendeeId

/** Where the call is, or is about to be. */
const channelOf = (s: Lifecycle): string | undefined =>
  s.current?.identity.channelId ?? s.wanted?.channelId ?? (s.request !== undefined && !s.cancel ? s.request.channelId : undefined)

/** Leaving the current call or intent (model `choose`, `leave`, `reportStop`, `quit`): what ends, if anything. */
const endedBy = (s: Lifecycle, reason: HuddleEnd['reason']): HuddleEnd | undefined => {
  const channelId = channelOf(s)
  return channelId === undefined ? s.ended : { channelId, reason }
}

/** Model `choose`: Start or Join. The current call, if any, becomes a leave that must happen. */
export const choose = (s: Lifecycle, intent: Intent): Lifecycle => ({
  ...s,
  wanted: intent,
  cancel: s.request !== undefined,
  current: undefined,
  otherDevice: false,
  muted: false,
  ended: undefined,
})

/** Model `leave`. */
export const leave = (s: Lifecycle): Lifecycle => ({
  ...s,
  wanted: undefined,
  current: undefined,
  cancel: s.request !== undefined,
  ended: endedBy(s, 'left'),
})

/**
 * Model `requestJoin`'s guard: a wanted join, none in flight, every
 * earlier attendee left and stopped, and no eviction since the last Start.
 * After a restart the stored records are `pending`, so they are replayed
 * before any new join.
 */
export const canRequest = (s: Lifecycle): s is Lifecycle & { readonly wanted: Intent } =>
  s.wanted !== undefined && s.request === undefined && s.pending.length === 0 && !s.otherDevice && !s.quitting

/** Model `requestJoin`. */
export const requestJoin = (s: Lifecycle & { readonly wanted: Intent }): Lifecycle => ({ ...s, request: s.wanted, wanted: undefined, cancel: false })

/**
 * Model `answerJoin`, after the identity was stored. A cancelled answer
 * becomes a leave at once and its credentials are never handed out;
 * otherwise it is the current call, and media is not running yet.
 */
export const answerJoin = (s: Lifecycle, identity: Identity): Lifecycle => ({
  ...s,
  request: undefined,
  pending: [...s.pending, { identity, sent: false, stopped: s.cancel }],
  current: s.cancel ? undefined : { identity, started: false },
})

/** Model `joinError`. */
export const joinError = (s: Lifecycle, code: string): Lifecycle => ({
  ...s,
  request: undefined,
  ended: s.cancel || s.request === undefined ? s.ended : { channelId: s.request.channelId, reason: 'joinFailed', code },
  cancel: false,
})

/**
 * The second half of model `startMedia`: the renderer started a session.
 * A start for another attendee is stale; the renderer stops it, since
 * `huddle.call` no longer names it.
 */
export const mediaStarted = (s: Lifecycle, attendeeId: string): Lifecycle =>
  s.current !== undefined && sameAttendee(currentAttendee(s), attendeeId) ? { ...s, current: { ...s.current, started: true } } : s

const markStopped = (pending: ReadonlyArray<Pending>, stop: (p: Pending) => boolean) =>
  pending.map((p) => (!p.stopped && stop(p) ? { ...p, stopped: true } : p))

/**
 * Model `forcedStop` then `reportStop`: a session ended, whether the engine
 * asked (`left`) or not. It counts as that attendee's stop. For the current
 * call it also ends the call and any queued join; after another device
 * took over, nothing joins until a new Start or Join. A report for an
 * earlier attendee ends nothing.
 */
export const mediaEnded = (s: Lifecycle, attendeeId: string, reason: HuddleMediaEnd): Lifecycle => {
  const pending = markStopped(s.pending, (p) => p.identity.attendeeId === attendeeId)
  if (!sameAttendee(currentAttendee(s), attendeeId)) return { ...s, pending }
  return {
    ...s,
    pending,
    current: undefined,
    wanted: undefined,
    cancel: s.request !== undefined,
    otherDevice: reason === 'anotherDevice',
    ended: endedBy(s, reason),
  }
}

/** No session runs in the renderer: every attendee but the current one is stopped. */
export const mediaIdle = (s: Lifecycle): Lifecycle => ({
  ...s,
  pending: markStopped(s.pending, (p) => !sameAttendee(p.identity.attendeeId, currentAttendee(s))),
})

export const mediaMuted = (s: Lifecycle, attendeeId: string, muted: boolean): Lifecycle =>
  sameAttendee(currentAttendee(s), attendeeId) ? { ...s, muted } : s

/** Model `sendLeave`'s guard: never the current call's attendee, once per process. */
export const toSend = (s: Lifecycle): ReadonlyArray<Identity> =>
  s.pending.filter((p) => !p.sent && !sameAttendee(p.identity.attendeeId, currentAttendee(s))).map((p) => p.identity)

/** Model `sendLeave`. */
export const sendLeave = (s: Lifecycle, attendeeId: string): Lifecycle => ({
  ...s,
  pending: s.pending.map((p) => (p.identity.attendeeId === attendeeId ? { ...p, sent: true } : p)),
})

/** Model `clearLeave`'s guard: sent and stopped. The answer to the leave does not matter. */
export const toClear = (s: Lifecycle): ReadonlyArray<Identity> =>
  s.pending.filter((p) => p.sent && p.stopped && !sameAttendee(p.identity.attendeeId, currentAttendee(s))).map((p) => p.identity)

/** Model `clearLeave`. */
export const clearLeave = (s: Lifecycle, attendeeIds: ReadonlySet<string>): Lifecycle => ({
  ...s,
  pending: s.pending.filter((p) => !attendeeIds.has(p.identity.attendeeId)),
})

/** Model `quit`, and the end of a session (sign-out, a new workspace). */
export const quit = (s: Lifecycle): Lifecycle => ({
  ...s,
  quitting: true,
  wanted: undefined,
  current: undefined,
  cancel: s.request !== undefined,
  ended: endedBy(s, 'left'),
})

/**
 * Model `restart`: the stored records of a session that starts, merged with
 * what this process still knows. A record this process never saw has not
 * been sent here, and is stopped only if the renderer said so.
 */
export const restart = (s: Lifecycle, stored: ReadonlyArray<Identity>, stopped: (attendeeId: string) => boolean): Lifecycle => {
  const known = new Set(s.pending.map((p) => p.identity.attendeeId))
  const loaded = stored.filter((identity) => !known.has(identity.attendeeId)).map((identity) => ({ identity, sent: false, stopped: stopped(identity.attendeeId) }))
  return { ...s, quitting: false, pending: [...s.pending, ...loaded] }
}

/**
 * The phase the UI shows. `joining` covers a wanted join waiting for an
 * earlier leave; `leaving` covers a cancelled request still out and leaves
 * not yet sent or stopped.
 */
export const phaseOf = (s: Lifecycle): HuddlePhase => {
  if (s.current !== undefined) return s.current.started ? 'joined' : 'joining'
  if (s.wanted !== undefined || (s.request !== undefined && !s.cancel)) return 'joining'
  if (s.request !== undefined || s.pending.length > 0) return 'leaving'
  return 'idle'
}

export const callChannel = channelOf
