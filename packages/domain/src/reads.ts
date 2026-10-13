/**
 * Read state (architecture 5.6, specs/readstate.qnt). Juno's pointer is the
 * state the sidebar shows and changes at once on a local mark. Slack's marks
 * from other clients reach it as events and pages, under these rules:
 *
 * - Slack's event stamps (`event_ts`) order only events: an event applies
 *   only when it is newer than the last one applied (`lastServerEventTs`).
 * - Juno's own clock orders only fetches (a page's request time): a page
 *   applies only when it was requested after the topic was last observed or
 *   changed (`observedAt`). No rule compares the two clocks.
 * - While a local mark is pending, nothing from Slack changes the pointer.
 *   An observation that disagrees with the mark is noted, and Slack is asked
 *   once the mark ends.
 * - Juno never learns when Slack accepted its own mark, so once Juno has
 *   sent one for a topic (`commanded`), an event that contradicts the
 *   pointer is not applied: Slack is asked instead.
 * - A page applies only when Slack's pointer differs from the one Juno last
 *   saw (`slackReadTs`). A mark Slack has not seen (mirroring off, or a
 *   topic Slack keeps no pointer for) survives pages that show an unchanged
 *   Slack.
 * - A page too old to apply that disagrees with the pointer asks Slack.
 *
 * Asking Slack is a lookup (`conversations.info` for Main, the thread's root
 * for a thread). Its answer is a page.
 */
import { compareTs, type Ts } from './ids'

export interface ReadState {
  /** Juno's pointer: messages after it are unread. */
  readonly lastReadTs?: Ts
  /** Set by Mark as unread: the row shows at least one unread. */
  readonly markedUnread: boolean
  /** A local mark is waiting in the outbox (`intent` says what it sends). */
  readonly pendingLocalWrite: boolean
  /** The pending mark's pointer and flag. Present while `pendingLocalWrite`. */
  readonly intent?: { readonly lastReadTs: Ts; readonly unread: boolean }
  /** Juno's clock when Slack last acknowledged a local mark. */
  readonly localWriteAckTs?: Ts
  /** Slack's `event_ts` of the last read event applied. */
  readonly lastServerEventTs?: Ts
  /** Juno's clock when the topic was last observed or changed: a page's request, an event's arrival, a mark and its end. */
  readonly observedAt?: Ts
  /** Slack's pointer as Juno last saw it. Absent when Juno does not know it. */
  readonly slackReadTs?: Ts
  /** Juno has sent a mark for this topic, so events that contradict the pointer are checked with Slack. Absent means no. */
  readonly commanded?: boolean
}

export const emptyReadState: ReadState = { markedUnread: false, pendingLocalWrite: false, commanded: false }

/**
 * Slack's read pointer for a topic, as one source reports it:
 * - `event`: a `*_marked` or `thread_marked` frame. `eventTs` is Slack's
 *   clock, `observedAt` Juno's at arrival.
 * - `page`: `client.counts`, a `getView` row, a root on a history or
 *   replies page, or a lookup. `requestedAt` is Juno's clock when the
 *   request started.
 */
export type ServerRead =
  | { readonly kind: 'event'; readonly lastReadTs: Ts; readonly eventTs: Ts; readonly observedAt: Ts }
  | { readonly kind: 'page'; readonly lastReadTs: Ts; readonly requestedAt: Ts }

/**
 * What an observation did:
 * - `applied`: the state changed (possibly only its watermarks);
 * - `ignored`: nothing to do;
 * - `noted`: a mark is pending; ask Slack after it ends;
 * - `lookup`: Slack must be asked now.
 */
export type ReadOutcome = 'applied' | 'ignored' | 'noted' | 'lookup'

export interface ObservedRead {
  readonly state: ReadState
  readonly outcome: ReadOutcome
}

const newer = (at: Ts, than: Ts | undefined): boolean => than === undefined || compareTs(at, than) > 0
const same = (a: Ts | undefined, b: Ts | undefined): boolean => a !== undefined && b !== undefined && compareTs(a, b) === 0

/** Applies Slack's pointer from an event or a page by the rules above. */
export function observeServerRead(state: ReadState, read: ServerRead): ObservedRead {
  const ignored = { state, outcome: 'ignored' } as const
  const matchesIntent = state.intent !== undefined && same(read.lastReadTs, state.intent.lastReadTs)
  const matchesPointer = same(read.lastReadTs, state.lastReadTs)
  const apply = (watermarks: Partial<ReadState>): ObservedRead => ({
    state: {
      ...state,
      ...watermarks,
      lastReadTs: read.lastReadTs,
      // A pointer that changes clears Mark as unread; one that repeats it keeps the flag.
      markedUnread: matchesPointer ? state.markedUnread : false,
      slackReadTs: read.lastReadTs,
    },
    outcome: 'applied',
  })

  if (read.kind === 'event') {
    if (!newer(read.eventTs, state.lastServerEventTs)) return ignored
    if (state.pendingLocalWrite) return matchesIntent ? ignored : { state, outcome: 'noted' }
    if (state.commanded === true && !matchesPointer) return { state, outcome: 'lookup' }
    // Its arrival is an observation: a page requested before it cannot apply.
    return apply({ lastServerEventTs: read.eventTs, observedAt: read.observedAt })
  }

  const fresh = newer(read.requestedAt, state.observedAt)
  if (state.pendingLocalWrite) return fresh && !matchesIntent ? { state, outcome: 'noted' } : ignored
  // Too old to apply: Slack may have changed before or after Juno's last change. Ask again when it disagrees.
  if (!fresh) return matchesPointer ? ignored : { state, outcome: 'lookup' }
  if (state.slackReadTs !== undefined && same(read.lastReadTs, state.slackReadTs)) return ignored
  return apply({ observedAt: read.requestedAt })
}

/**
 * A local Mark read up to `upTo` at `at` (Juno's clock). The pointer never
 * moves back. Returns `undefined` when nothing changes. `mirrors` says the
 * mark goes to Slack, so the outbox row is written in the same transaction.
 */
export function markReadLocally(state: ReadState, upTo: Ts, at: Ts, mirrors: boolean): ReadState | undefined {
  const pointer = state.lastReadTs !== undefined && compareTs(upTo, state.lastReadTs) < 0 ? state.lastReadTs : upTo
  if (same(pointer, state.lastReadTs) && !state.markedUnread) return undefined
  return local(state, pointer, false, at, mirrors)
}

/**
 * A local Mark as unread: the pointer moves to `pointer` (just before the
 * first unread message) and the flag keeps the count at one or more.
 * Returns `undefined` when nothing changes.
 */
export function markUnreadLocally(state: ReadState, pointer: Ts, at: Ts, mirrors: boolean): ReadState | undefined {
  if (same(pointer, state.lastReadTs) && state.markedUnread) return undefined
  return local(state, pointer, true, at, mirrors)
}

function local(state: ReadState, pointer: Ts, unread: boolean, at: Ts, mirrors: boolean): ReadState {
  return {
    ...state,
    lastReadTs: pointer,
    markedUnread: unread,
    observedAt: at,
    ...(mirrors ? { commanded: true, pendingLocalWrite: true, intent: { lastReadTs: pointer, unread } } : {}),
  }
}

/**
 * Slack accepted the pending mark that set its pointer to `sent`, answered
 * at `at` (Juno's clock). `done` is false when a newer local mark replaced
 * the row's intent meanwhile; the row then stays pending and is sent again.
 * The answer stamps `observedAt`, so a page requested while the mark was
 * pending cannot apply afterwards.
 */
export function acknowledgeLocalWrite(state: ReadState, sent: Ts, at: Ts, done: boolean): ReadState {
  return {
    ...state,
    slackReadTs: sent,
    observedAt: laterOf(state.observedAt, at),
    localWriteAckTs: at,
    ...(done ? { pendingLocalWrite: false, intent: undefined } : {}),
  }
}

/** Slack refused the pending mark at `at`. Juno no longer knows Slack's pointer; the caller asks Slack. */
export function rejectLocalWrite(state: ReadState, at: Ts): ReadState {
  return { ...state, slackReadTs: undefined, observedAt: laterOf(state.observedAt, at), pendingLocalWrite: false, intent: undefined }
}

const laterOf = (a: Ts | undefined, b: Ts): Ts => (a === undefined || compareTs(b, a) > 0 ? b : a)

/** The ts one microsecond before `ts`: a pointer that leaves the message at `ts` unread. */
export function tsBefore(ts: Ts): Ts {
  const [seconds, fraction] = ts.split('.') as [string, string]
  const micros = BigInt(seconds) * 1_000_000n + BigInt(fraction) - 1n
  const whole = micros / 1_000_000n
  const rest = micros % 1_000_000n
  return `${whole}.${String(rest).padStart(6, '0')}` as Ts
}
