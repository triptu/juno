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
 *   user.db. `unsent` is `dispatch !== 'dispatched'`.
 * - `media` and `stopped`: not kept here. Whether an attendee's media is
 *   stopped is computed from the pages' current state (`media.ts`), so
 *   reports, page ends and loads may come in any order.
 * - `otherDevice`, `quitting`: the same names.
 * - `phase`: derived for the UI by `phaseOf`.
 */
import type { HuddleEnd, HuddlePhase, HuddleWait } from '@juno/contract'
import { endReason, holding, mediaStopped, pageState, type MediaView } from './media'

/** What `rooms.join` returned: enough to leave. The Chime credentials are not kept here. */
export interface Identity {
  readonly channelId: string
  readonly callId: string
  readonly attendeeId: string
}

/** A stored record: the identity, and the renderer page generation its credentials went to (null: never handed out). */
export interface Stored extends Identity {
  readonly generation: number | null
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
}

export interface Intent {
  readonly channelId: string
  readonly region: string | null
  /** The renderer page that asked, which gets the credentials. */
  readonly generation: number
  /** Ties the intent to the Start that asked for it, so its caller gets the answer. */
  readonly ticket: number
}

export interface Current {
  readonly identity: Identity
  readonly generation: number
}

export interface Lifecycle {
  /** A Start or Join not yet sent: it waits for the pending leaves, and for main to list its page. */
  readonly wanted: Intent | undefined
  /** The `rooms.join` in flight. Only one at a time. */
  readonly request: Intent | undefined
  /** The request in flight was replaced, left, or its page went: its answer is cleaned up, never used. */
  readonly cancel: boolean
  readonly current: Current | undefined
  readonly pending: ReadonlyArray<Pending>
  /** Chime moved the user to another device. No join until a new Start or Join. */
  readonly otherDevice: boolean
  readonly quitting: boolean
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
  ended: undefined,
}

const sameAttendee = (a: string | undefined, b: string | undefined) => a !== undefined && a === b

/** The attendee whose media may run: the current call's. Every other attendee's session must stop. */
export const currentAttendee = (s: Lifecycle): string | undefined => s.current?.identity.attendeeId

const currentRecord = (current: Current): Stored => ({ ...current.identity, generation: current.generation })

/** Where the call is, or is about to be. */
export const callChannel = (s: Lifecycle): string | undefined =>
  s.current?.identity.channelId ?? s.wanted?.channelId ?? (s.request !== undefined && !s.cancel ? s.request.channelId : undefined)

/** Leaving the current call or intent (model `choose`, `leave`, `reportStop`, `quit`): what ends, if anything. */
const endedBy = (s: Lifecycle, reason: HuddleEnd['reason']): HuddleEnd | undefined => {
  const channelId = callChannel(s)
  return channelId === undefined ? s.ended : { channelId, reason }
}

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
  ended: undefined,
})

/** Model `leave`. `alone`: Juno left after 10 minutes with nobody else in the call (`alone.ts`). */
export const leave = (s: Lifecycle, reason: 'left' | 'alone' = 'left'): Lifecycle => ({
  ...s,
  wanted: undefined,
  current: undefined,
  cancel: s.request !== undefined,
  ended: endedBy(s, reason),
})

/**
 * What the pages' state means for the call (model `reportStop` and the
 * page-gone rules): the current call ends once its media stopped, a queued
 * Start of a page that is gone is dropped, and a join in flight for one is
 * cancelled. Run after every change.
 */
export const reconcile = (s: Lifecycle, view: MediaView): Lifecycle => {
  let next = s
  if (next.wanted !== undefined && pageState(view, next.wanted.generation) === 'gone') next = { ...next, wanted: undefined }
  if (next.request !== undefined && !next.cancel && pageState(view, next.request.generation) === 'gone') next = { ...next, cancel: true }
  if (next.current !== undefined && mediaStopped(view, currentRecord(next.current))) {
    const reason = endReason(view, currentRecord(next.current))
    next = { ...next, current: undefined, wanted: undefined, cancel: next.request !== undefined, otherDevice: reason === 'anotherDevice', ended: endedBy(next, reason) }
  }
  return next
}

/**
 * Model `requestJoin`'s guard: a wanted join from a page main lists, none
 * in flight, the stored leaves of every workspace loaded (`loaded`), none
 * of this workspace's left, every attendee of another workspace stopped,
 * and no eviction since the last Start. After a restart the stored records
 * are `pending`, so they go out before any new join.
 */
export const canRequest = (s: Lifecycle, view: MediaView, workspace: string, loaded: boolean): s is Lifecycle & { readonly wanted: Intent } =>
  s.wanted !== undefined && !s.otherDevice && !s.quitting && joinWait(s, view, workspace, loaded) === undefined

/**
 * What a wanted join still waits for (the UI shows it while `joining`), or
 * undefined when none is wanted or it may go: the stored leaves not read yet
 * (`store`); an earlier call still ending, through its join in flight, its
 * leave or its media (`lastCall`); or main not listing the asking page yet
 * (`page`).
 */
export const joinWait = (s: Lifecycle, view: MediaView, workspace: string | undefined, loaded: boolean): HuddleWait | undefined => {
  if (s.wanted === undefined) return undefined
  if (!loaded || workspace === undefined) return 'store'
  if (s.request !== undefined || s.pending.some((p) => p.workspace === workspace || !mediaStopped(view, p.record))) return 'lastCall'
  if (pageState(view, s.wanted.generation) !== 'live') return 'page'
  return undefined
}

/** Model `requestJoin`. */
export const requestJoin = (s: Lifecycle & { readonly wanted: Intent }): Lifecycle => ({ ...s, request: s.wanted, wanted: undefined, cancel: false })

/**
 * The record `answerJoin` stores for an answer. It goes to the asking page
 * only if the join was not cancelled, main still lists the page, and the
 * Start that asked is still waiting (`callerWaiting`: its connection did not
 * close); else no page ever had its media, and it is left at once.
 */
export const recordFor = (s: Lifecycle, view: MediaView, identity: Identity, callerWaiting: boolean): Stored => ({
  ...identity,
  generation: !s.cancel && callerWaiting && s.request !== undefined && pageState(view, s.request.generation) === 'live' ? s.request.generation : null,
})

/**
 * Model `answerJoin`, after `record` was stored. A record no page holds is a
 * leave at once; otherwise it is the current call. A join that was not
 * cancelled but reached no page ends as a lost connection.
 */
export const answerJoin = (s: Lifecycle, record: Stored, workspace: string): Lifecycle => {
  const { generation, ...identity } = record
  return {
    ...s,
    request: undefined,
    pending: [...s.pending, { record, workspace, dispatch: 'queued' }],
    current: generation === null ? undefined : { identity, generation },
    ended: generation === null && !s.cancel && s.request !== undefined ? { channelId: s.request.channelId, reason: 'connectionLost' } : s.ended,
  }
}

/** Model `joinError`. */
export const joinError = (s: Lifecycle, code: string): Lifecycle => ({
  ...s,
  request: undefined,
  ended: s.cancel || s.request === undefined ? s.ended : { channelId: s.request.channelId, reason: 'joinFailed', code },
  cancel: false,
})

/** Model `sendLeave`'s guard: leaves of this workspace not yet given to the client, never the current call's. */
export const toSend = (s: Lifecycle, workspace: string): ReadonlyArray<Stored> =>
  s.pending.filter((p) => p.workspace === workspace && p.dispatch === 'queued' && !sameAttendee(p.record.attendeeId, currentAttendee(s))).map((p) => p.record)

/** Given to the client. */
export const sending = (s: Lifecycle, attendeeId: string): Lifecycle => update(s, attendeeId, (p) => ({ ...p, dispatch: 'sending' }))

/** Model `sendLeave`: the request went out. */
export const dispatched = (s: Lifecycle, attendeeId: string): Lifecycle => update(s, attendeeId, (p) => ({ ...p, dispatch: 'dispatched' }))

/**
 * Model `leaveAnswer` refused: Slack did not take the leave. It must go out
 * again, after a pause; a record already cleared comes back.
 */
export const refused = (s: Lifecycle, record: Stored, workspace: string): Lifecycle =>
  s.pending.some((p) => p.record.attendeeId === record.attendeeId)
    ? update(s, record.attendeeId, (p) => ({ ...p, dispatch: 'waiting' }))
    : { ...s, pending: [...s.pending, { record, workspace, dispatch: 'waiting' }] }

/** The pause after a refusal is over. */
export const retry = (s: Lifecycle, attendeeId: string): Lifecycle =>
  update(s, attendeeId, (p) => (p.dispatch === 'waiting' ? { ...p, dispatch: 'queued' } : p))

/** Model `clearLeave`'s guard: dispatched and its media stopped. The answer to the leave is not awaited. */
export const toClear = (s: Lifecycle, view: MediaView, workspace: string): ReadonlyArray<Stored> =>
  s.pending
    .filter((p) => p.workspace === workspace && p.dispatch === 'dispatched' && !sameAttendee(p.record.attendeeId, currentAttendee(s)) && mediaStopped(view, p.record))
    .map((p) => p.record)

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
 * so the stop barrier holds across a workspace change.
 */
export const detached = (s: Lifecycle, workspace: string): Lifecycle => ({
  ...quit(s),
  request: undefined,
  cancel: false,
  pending: s.pending.map((p) => (p.workspace === workspace && p.dispatch !== 'dispatched' ? { ...p, dispatch: 'queued' } : p)),
})

/** Stored records of `workspace` merged with what this process already knows. A record new to this process has not been sent here. */
export const merge = (s: Lifecycle, stored: ReadonlyArray<Stored>, workspace: string): Lifecycle => {
  const known = new Set(s.pending.map((p) => p.record.attendeeId))
  const loaded = stored.filter((record) => !known.has(record.attendeeId)).map((record): Pending => ({ record, workspace, dispatch: 'queued' }))
  return { ...s, pending: [...s.pending, ...loaded] }
}

/** Model `restart`, once a session's stored records are loaded. */
export const restart = (s: Lifecycle, stored: ReadonlyArray<Stored>, workspace: string): Lifecycle => ({ ...merge(s, stored, workspace), quitting: false })

/** The holding page's report while the current call's session is up, for the UI. */
export const currentMedia = (s: Lifecycle, view: MediaView) =>
  s.current === undefined ? undefined : holding(view, s.current.generation, s.current.identity.attendeeId)

/**
 * The phase the UI shows. `joining` covers a wanted join waiting for an
 * earlier leave or for its page to be listed; `leaving` covers a cancelled
 * request still out and media not yet stopped.
 */
export const phaseOf = (s: Lifecycle, view: MediaView): HuddlePhase => {
  if (s.current !== undefined) {
    const media = currentMedia(s, view)
    return media !== undefined && media.connection !== 'connecting' ? 'joined' : 'joining'
  }
  if (s.wanted !== undefined || (s.request !== undefined && !s.cancel)) return 'joining'
  if (s.request !== undefined || s.pending.some((p) => !mediaStopped(view, p.record))) return 'leaving'
  return 'idle'
}
