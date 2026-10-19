/**
 * The call's lifecycle for one user, as pure rules (specs/huddle.qnt).
 *
 * Each function is one action of the model, under the model's name, and
 * returns the next state. `core.ts` runs them one at a time under a lock
 * and does the I/O they call for: `rooms.join` once `canRequest`,
 * `rooms.leave` for `toSend`, the stored record's delete for `toClear`.
 *
 * Model variables and where they live here:
 * - `wanted`, `request`, `cancel`, `current`: the same names.
 * - `pending` (durable): `pending[].record`, stored in its workspace's
 *   user.db. `unsent` is `dispatch !== 'dispatched'`; `stopped` is `stopped`.
 * - `media`: the attendees a renderer page may be running: every pending
 *   record not `stopped`, the current call's among them. A record names the
 *   page generation its credentials went to; only that generation's reports,
 *   or main saying that page is gone, stop it.
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

/** A stored record: the identity, and the renderer page generation its credentials went to (null: never handed out). */
export interface Stored extends Identity {
  readonly generation: string | null
}

/**
 * Where a leave stands in this process. `queued`: to send. `sending`: given
 * to the Slack client, not on the wire yet (it may wait for its lane or a
 * rate limit). `dispatched`: the request went out. `waiting`: refused before
 * Slack took it (a rate limit, the network, the session); sent again later.
 */
export type Dispatch = 'queued' | 'sending' | 'dispatched' | 'waiting'

/** A leave that must happen, in the workspace whose store holds it. */
export interface Pending {
  readonly record: Stored
  readonly workspace: string
  readonly dispatch: Dispatch
  /** No media session runs for this attendee. */
  readonly stopped: boolean
}

export interface Intent {
  readonly channelId: string
  readonly region: string | null
  /** The renderer page that asked, which gets the credentials. */
  readonly generation: string
  /** Ties the intent to the Start that asked for it, so its caller gets the answer. */
  readonly ticket: number
}

export interface Current {
  readonly identity: Identity
  readonly generation: string
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

/** Whether main said a renderer page generation is gone (its media torn down with it). */
export type Gone = (generation: string) => boolean

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

/** Whether a report from `generation` about `attendeeId` is about the current call. */
const isCurrent = (s: Lifecycle, generation: string, attendeeId: string) =>
  s.current !== undefined && s.current.generation === generation && s.current.identity.attendeeId === attendeeId

/** Where the call is, or is about to be. */
export const callChannel = (s: Lifecycle): string | undefined =>
  s.current?.identity.channelId ?? s.wanted?.channelId ?? (s.request !== undefined && !s.cancel ? s.request.channelId : undefined)

/** Leaving the current call or intent (model `choose`, `leave`, `reportStop`, `quit`): what ends, if anything. */
const endedBy = (s: Lifecycle, reason: HuddleEnd['reason']): HuddleEnd | undefined => {
  const channelId = callChannel(s)
  return channelId === undefined ? s.ended : { channelId, reason }
}

/** Ends the current call, whose media stopped (model `reportStop`). A queued join goes too. */
const endCurrent = (s: Lifecycle, reason: HuddleMediaEnd): Lifecycle => ({
  ...s,
  current: undefined,
  wanted: undefined,
  cancel: s.request !== undefined,
  otherDevice: reason === 'anotherDevice',
  ended: endedBy(s, reason),
})

const update = (s: Lifecycle, attendeeId: string, change: (p: Pending) => Pending): Lifecycle => ({
  ...s,
  pending: s.pending.map((p) => (p.record.attendeeId === attendeeId ? change(p) : p)),
})

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
 * Model `requestJoin`'s guard: a wanted join, none in flight, the session's
 * stored leaves loaded, none of them left, every attendee of another
 * workspace stopped, and no eviction since the last Start. After a restart
 * the stored records are `pending`, so they go out before any new join.
 */
export const canRequest = (s: Lifecycle, workspace: string, loaded: boolean): s is Lifecycle & { readonly wanted: Intent } =>
  s.wanted !== undefined && s.request === undefined && loaded && !s.otherDevice && !s.quitting &&
  s.pending.every((p) => p.workspace !== workspace && p.stopped)

/** Model `requestJoin`. */
export const requestJoin = (s: Lifecycle & { readonly wanted: Intent }): Lifecycle => ({ ...s, request: s.wanted, wanted: undefined, cancel: false })

/** The record `answerJoin` stores for an answer: a cancelled one is never handed out, so no page holds it. */
export const recordFor = (s: Lifecycle, identity: Identity): Stored => ({
  ...identity,
  generation: s.cancel || s.request === undefined ? null : s.request.generation,
})

/**
 * Model `answerJoin`, after `record` was stored. A cancelled answer becomes
 * a leave at once; otherwise it is the current call, and media is not
 * running yet.
 */
export const answerJoin = (s: Lifecycle, record: Stored, workspace: string): Lifecycle => {
  const { generation, ...identity } = record
  return {
    ...s,
    request: undefined,
    pending: [...s.pending, { record, workspace, dispatch: 'queued', stopped: generation === null }],
    current: generation === null ? undefined : { identity, generation, started: false },
  }
}

/** Model `joinError`. */
export const joinError = (s: Lifecycle, code: string): Lifecycle => ({
  ...s,
  request: undefined,
  ended: s.cancel || s.request === undefined ? s.ended : { channelId: s.request.channelId, reason: 'joinFailed', code },
  cancel: false,
})

/** The second half of model `startMedia`: the page holding the current credentials started its session. Any other start is stale. */
export const mediaStarted = (s: Lifecycle, generation: string, attendeeId: string): Lifecycle =>
  s.current !== undefined && isCurrent(s, generation, attendeeId) ? { ...s, current: { ...s.current, started: true } } : s

/**
 * Model `forcedStop` then `reportStop`: the page holding an attendee's
 * credentials says its session ended, whether the engine asked (`left`) or
 * not. For the current call it also ends the call and any queued join.
 * A report from another page, or about an earlier attendee, ends nothing.
 */
export const mediaEnded = (s: Lifecycle, generation: string, attendeeId: string, reason: HuddleMediaEnd): Lifecycle => {
  const stopped = update(s, attendeeId, (p) => (p.record.generation === generation ? { ...p, stopped: true } : p))
  return isCurrent(s, generation, attendeeId) ? endCurrent(stopped, reason) : stopped
}

export const mediaMuted = (s: Lifecycle, generation: string, attendeeId: string, muted: boolean): Lifecycle =>
  isCurrent(s, generation, attendeeId) ? { ...s, muted } : s

/**
 * Main said renderer pages are gone: a destroyed or unloaded page has torn
 * down its WebRTC, so the attendees it held are stopped. The only stop the
 * engine assumes.
 */
export const pagesGone = (s: Lifecycle, gone: Gone): Lifecycle => {
  const stopped = { ...s, pending: s.pending.map((p) => (!p.stopped && p.record.generation !== null && gone(p.record.generation) ? { ...p, stopped: true } : p)) }
  return s.current !== undefined && gone(s.current.generation) ? endCurrent(stopped, 'connectionLost') : stopped
}

/** Model `sendLeave`'s guard: leaves of this workspace not yet given to the client, never the current call's. */
export const toSend = (s: Lifecycle, workspace: string): ReadonlyArray<Stored> =>
  s.pending.filter((p) => p.workspace === workspace && p.dispatch === 'queued' && !sameAttendee(p.record.attendeeId, currentAttendee(s))).map((p) => p.record)

/** Given to the client. */
export const sending = (s: Lifecycle, attendeeId: string): Lifecycle => update(s, attendeeId, (p) => ({ ...p, dispatch: 'sending' }))

/** Model `sendLeave`: the request went out. */
export const dispatched = (s: Lifecycle, attendeeId: string): Lifecycle => update(s, attendeeId, (p) => ({ ...p, dispatch: 'dispatched' }))

/**
 * The leave was refused before Slack took it. It must go out again, after
 * a pause; a record already cleared comes back (its media was stopped).
 */
export const refused = (s: Lifecycle, record: Stored, workspace: string): Lifecycle =>
  s.pending.some((p) => p.record.attendeeId === record.attendeeId)
    ? update(s, record.attendeeId, (p) => ({ ...p, dispatch: 'waiting' }))
    : { ...s, pending: [...s.pending, { record, workspace, dispatch: 'waiting', stopped: true }] }

/** The pause after a refusal is over. */
export const retry = (s: Lifecycle, attendeeId: string): Lifecycle =>
  update(s, attendeeId, (p) => (p.dispatch === 'waiting' ? { ...p, dispatch: 'queued' } : p))

/** Model `clearLeave`'s guard: dispatched and stopped. The answer to the leave is not awaited. */
export const toClear = (s: Lifecycle, workspace: string): ReadonlyArray<Stored> =>
  s.pending.filter((p) => p.workspace === workspace && p.dispatch === 'dispatched' && p.stopped && !sameAttendee(p.record.attendeeId, currentAttendee(s))).map((p) => p.record)

/** Model `clearLeave`. */
export const clearLeave = (s: Lifecycle, attendeeIds: ReadonlySet<string>): Lifecycle => ({
  ...s,
  pending: s.pending.filter((p) => !attendeeIds.has(p.record.attendeeId)),
})

/** The records `workspace`'s store must hold. */
export const storedIn = (s: Lifecycle, workspace: string): ReadonlyArray<Stored> =>
  s.pending.filter((p) => p.workspace === workspace).map((p) => p.record)

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
 * After a session ended: no request is out, and leaves of its workspace
 * not yet on the wire are queued for its next session. Every record stays,
 * with what is known of its media, so the stop barrier holds across a
 * workspace change.
 */
export const detached = (s: Lifecycle, workspace: string): Lifecycle => ({
  ...quit(s),
  request: undefined,
  cancel: false,
  pending: s.pending.map((p) => (p.workspace === workspace && p.dispatch !== 'dispatched' ? { ...p, dispatch: 'queued' } : p)),
})

/**
 * Model `restart`: the stored records of a session that starts, merged with
 * what this process already knows. A record new to this process has not
 * been sent here; it is stopped only if no page held it, or main said its
 * page is gone.
 */
export const restart = (s: Lifecycle, stored: ReadonlyArray<Stored>, workspace: string, gone: Gone): Lifecycle => {
  const known = new Set(s.pending.map((p) => p.record.attendeeId))
  const loaded = stored
    .filter((record) => !known.has(record.attendeeId))
    .map((record): Pending => ({ record, workspace, dispatch: 'queued', stopped: record.generation === null || gone(record.generation) }))
  return { ...s, quitting: false, pending: [...s.pending, ...loaded] }
}

/**
 * The phase the UI shows. `joining` covers a wanted join waiting for an
 * earlier leave; `leaving` covers a cancelled request still out and media
 * not yet stopped.
 */
export const phaseOf = (s: Lifecycle): HuddlePhase => {
  if (s.current !== undefined) return s.current.started ? 'joined' : 'joining'
  if (s.wanted !== undefined || (s.request !== undefined && !s.cancel)) return 'joining'
  if (s.request !== undefined || s.pending.some((p) => !p.stopped)) return 'leaving'
  return 'idle'
}
