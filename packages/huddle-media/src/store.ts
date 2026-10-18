/**
 * The session's snapshot store: `subscribe` and `getSnapshot` for
 * `useSyncExternalStore`. Each change is folded into the snapshot with
 * structural sharing, so an unchanged snapshot, attendee or device list keeps
 * its identity and React skips it.
 */
import type { MediaSnapshot } from './types.ts'

/** Volume and speaking changes publish at most this often: about 10 snapshots a second. */
export const THROTTLE_MS = 100

/**
 * `next` with every part that deep-equals the same part of `prev` replaced by
 * `prev`'s. Returns `prev` itself when nothing changed. Plain objects, arrays
 * and primitives only, which is all a snapshot holds.
 */
export function share<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev
  if (typeof prev !== 'object' || typeof next !== 'object' || prev === null || next === null) return next
  if (Array.isArray(prev) !== Array.isArray(next)) return next
  if (Array.isArray(prev) && Array.isArray(next)) {
    const out = next.map((item, i) => share(prev[i], item))
    return out.length === prev.length && out.every((item, i) => item === prev[i]) ? prev : (out as T)
  }
  const before = prev as Record<string, unknown>
  const after = next as Record<string, unknown>
  const out: Record<string, unknown> = {}
  let same = Object.keys(before).length === Object.keys(after).length
  for (const key of Object.keys(after)) {
    out[key] = share(before[key], after[key])
    if (out[key] !== before[key] || !(key in before)) same = false
  }
  return same ? prev : (out as T)
}

export type Change = (snapshot: MediaSnapshot) => MediaSnapshot

export class SnapshotStore {
  #snapshot: MediaSnapshot
  /** Throttled changes not yet published, folded in order. */
  #pending: MediaSnapshot | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #lastPublish = Number.NEGATIVE_INFINITY
  readonly #listeners = new Set<() => void>()

  constructor(initial: MediaSnapshot) {
    this.#snapshot = initial
  }

  getSnapshot = (): MediaSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Publishes at once, with any throttled changes still waiting. */
  update(change: Change): void {
    this.#pending = change(this.#pending ?? this.#snapshot)
    this.#flush()
  }

  /** Publishes within `THROTTLE_MS` of the last publish. For volume and speaking. */
  updateThrottled(change: Change): void {
    this.#pending = change(this.#pending ?? this.#snapshot)
    if (this.#timer !== undefined) return
    const wait = this.#lastPublish + THROTTLE_MS - Date.now()
    if (wait <= 0) return this.#flush()
    this.#timer = setTimeout(() => this.#flush(), wait)
  }

  #flush(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    const next = this.#pending
    this.#pending = undefined
    if (next === undefined) return
    const shared = share(this.#snapshot, next)
    if (shared === this.#snapshot) return
    this.#snapshot = shared
    this.#lastPublish = Date.now()
    for (const listener of [...this.#listeners]) listener()
  }
}
