/**
 * The compactor (plan v3 §4.1, §4.2, §5.4; spec `agent-memory.qnt` `start`,
 * `publish`, `failJob`). It runs memory jobs in the background through
 * WP8's `runJob` seam with WP9's compaction provider, so every model call
 * goes through the guard and the compaction share of the cap.
 *
 * - At most 8 jobs run at once; `readyKeys` picks them in due order.
 * - While a run is live, no job starts past its cutoff `H` (G2): the
 *   router's cutoff is passed to every job, and publication rechecks it.
 * - It wakes when the router projects new messages or a run ends (`poke`),
 *   and at the next `due_at` of a waiting key, so a retry needs no new
 *   message.
 * - It pauses while Juno is paused or off, and while compaction's share of
 *   today's cap (25%) is used up (G5); the tail placeholder covers the gap.
 *   A raise or a new day starts it again.
 *
 * A turn never waits for it: jobs run beside the run and publish under the
 * head's compare-and-swap.
 */
import { limits, type Key } from '@juno/agent-memory'
import type { SpendLedger } from '../spend'
import { mode } from '../store/ledger'
import { readyKeys, runJob, type CompactionModel } from '../store/memory'
import type { Store } from '../store/store'

/** The longest the compactor sleeps before it looks again (a new day, a raise). */
const RECHECK_MS = 60_000

export type CompactorState = 'idle' | 'running' | 'paused' | 'budget'

export interface CompactorOptions {
  readonly store: Store
  readonly model: CompactionModel
  readonly spend: SpendLedger
  /** The live run's history cutoff, or undefined between runs. */
  readonly cutoff: () => number | undefined
  readonly onReport?: (error: unknown) => void
}

const name = (key: Key) => `${key.a}:${key.w}`

export function createCompactor(options: CompactorOptions) {
  const { store, model, spend } = options
  const active = new Map<string, Key>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let state: CompactorState = 'idle'
  const idleWaiters: Array<() => void> = []
  const jobs = new Set<Promise<void>>()
  // Keys whose job found nothing to do (inputs changed under it); tried again after the next poke.
  const skipped = new Set<string>()

  /** Compaction may use at most a quarter of today's cap and raises, inside the cap. */
  const shareLeft = () => {
    const today = spend.snapshot()
    const limit = today.cap + today.raises
    return today.compaction < Math.floor(limit / 4) && today.reserved + today.actual < limit
  }

  const sleep = (ms: number) => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      tick()
    }, Math.max(0, Math.min(ms, RECHECK_MS)))
  }

  const settleIdle = () => {
    if (active.size > 0) return
    if (state === 'running') state = 'idle'
    for (const resolve of idleWaiters.splice(0)) resolve()
  }

  const tick = () => {
    if (closed) return
    if (mode(store) !== 'on') {
      state = 'paused'
      return settleIdle()
    }
    if (!shareLeft()) {
      state = 'budget'
      sleep(RECHECK_MS)
      return settleIdle()
    }
    const ready = readyKeys(store, { now: store.now(), active: [...active.values()], h: options.cutoff() })
    for (const key of ready) {
      if (active.size >= limits.workers) break
      if (active.has(name(key)) || skipped.has(name(key))) continue
      active.set(name(key), key)
      state = 'running'
      const job = runJob(store, key, model, options.cutoff())
        .then(
          (result) => {
            if (result === 'unavailable' || result === 'stale') skipped.add(name(key))
          },
          (error: unknown) => options.onReport?.(error),
        )
        .finally(() => {
          active.delete(name(key))
          jobs.delete(job)
          tick()
        })
      jobs.add(job)
    }
    if (active.size === 0) {
      const next = store.db.prepare('SELECT min(due_at) AS at FROM queue WHERE due_at > ?').get(store.now()) as { at: number | null }
      if (next.at !== null) sleep(next.at - store.now())
      if (state !== 'budget') state = 'idle'
      settleIdle()
    }
  }

  return {
    /** New messages were projected, a run ended, or Juno resumed. */
    poke: () => {
      skipped.clear()
      queueMicrotask(tick)
    },
    state: (): CompactorState => state,
    /** Resolves when no job runs and none is ready now. */
    idle: () =>
      new Promise<void>((resolve) => {
        idleWaiters.push(resolve)
        queueMicrotask(tick)
      }),
    close: async () => {
      closed = true
      if (timer !== undefined) clearTimeout(timer)
      await Promise.all(jobs)
      for (const resolve of idleWaiters.splice(0)) resolve()
    },
  }
}

export type Compactor = ReturnType<typeof createCompactor>
