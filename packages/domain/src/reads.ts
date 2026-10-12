/**
 * Read state (architecture 5.6). Juno's `last_read_ts` updates at once. A
 * local write still pending in the outbox wins over server events. Once
 * acknowledged, server `*_marked` events apply in `event_ts` order and
 * anything older than the acknowledgement is ignored.
 */
import { compareTs, type Ts } from './ids'

export interface ReadState {
  readonly lastReadTs?: Ts
  /** Set by Mark as unread: the row shows at least one unread. */
  readonly markedUnread: boolean
  /** A local mark is queued in the outbox and not yet acknowledged. */
  readonly pendingLocalWrite: boolean
  /** Event time of the acknowledgement of the last local write. */
  readonly localWriteAckTs?: Ts
  /** Event time of the last server event applied, so events apply in order. */
  readonly lastServerEventTs?: Ts
}

export interface ServerReadEvent {
  readonly lastReadTs: Ts
  readonly eventTs: Ts
}

/** Applies a server mark. Returns the same object when the event is ignored. */
export function applyServerRead(state: ReadState, event: ServerReadEvent): ReadState {
  if (state.pendingLocalWrite) return state
  if (state.localWriteAckTs !== undefined && compareTs(event.eventTs, state.localWriteAckTs) <= 0) return state
  if (state.lastServerEventTs !== undefined && compareTs(event.eventTs, state.lastServerEventTs) <= 0) return state
  return { ...state, lastReadTs: event.lastReadTs, markedUnread: false, lastServerEventTs: event.eventTs }
}

/** A local mark read: moves the pointer now and flags the outbox write. */
export function markReadLocally(state: ReadState, latestTs: Ts): ReadState {
  if (state.lastReadTs !== undefined && compareTs(latestTs, state.lastReadTs) < 0) latestTs = state.lastReadTs
  return { ...state, lastReadTs: latestTs, markedUnread: false, pendingLocalWrite: true }
}

/** A local mark unread: the pointer moves before `firstUnreadTs` and the flag keeps the count at one or more. */
export function markUnreadLocally(state: ReadState, tsBeforeFirstUnread: Ts | undefined): ReadState {
  return { ...state, ...(tsBeforeFirstUnread !== undefined ? { lastReadTs: tsBeforeFirstUnread } : {}), markedUnread: true, pendingLocalWrite: true }
}

/** The outbox acknowledged the local write at `ackTs`. */
export function acknowledgeLocalWrite(state: ReadState, ackTs: Ts): ReadState {
  return { ...state, pendingLocalWrite: false, localWriteAckTs: ackTs }
}
