/**
 * Performance marks and measures (performance.md 7.1).
 *
 * A fixed set of names so the harness and the DevTools "Juno" track agree.
 * Every measure sets `detail.devtools`, which Chrome's performance panel
 * renders as a custom track. The file does not depend on DOM types, so the
 * same module loads under Node in tests and does nothing there.
 */

export type PerfName =
  | 'juno.start'
  | 'juno.shell-paint'
  | 'juno.sidebar-rows'
  /** Mark: the sidebar's first snapshot has reached the renderer. */
  | 'juno.sidebar-snapshot'
  /** From `juno.sidebar-snapshot` to the first rows painted. */
  | 'juno.sidebar-paint'
  | 'juno.topic-open'
  | 'juno.tab-switch'
  | 'juno.filter'
  | 'juno.palette-open'
  | 'juno.palette-results'
  | 'juno.send'
  | 'juno.live-update'
  /** Enter in a Juno composer to the owner's bubble painted (SPEC 13.12: within a frame). */
  | 'juno.chat-send'
  /** Enter in a Juno composer to Juno's first bubble of the answer painted (SPEC 13.12: 2.5 s on OpenRouter). */
  | 'juno.chat-bubble'
  /** ⌘J or the header's Juno button to the panel painted with its composer (one frame). */
  | 'juno.panel-open'

const TRACK = 'Juno'

interface PerformanceLike {
  readonly timeOrigin: number
  now(): number
  mark(name: string, options?: { readonly detail?: unknown }): { readonly startTime: number }
  measure(name: string, options: { readonly start: string | number; readonly end: number; readonly detail?: unknown }): unknown
  clearMeasures?(name?: string): void
}

interface EntryLike {
  readonly entryType: string
  readonly name: string
  readonly duration: number
  readonly startTime: number
}

interface ObserverLike {
  observe(options: { readonly type: string; readonly buffered?: boolean; readonly durationThreshold?: number }): void
}

interface Globals {
  readonly performance?: PerformanceLike
  readonly PerformanceObserver?: new (callback: (list: { getEntries(): ReadonlyArray<EntryLike> }) => void) => ObserverLike
  readonly requestAnimationFrame?: (callback: () => void) => unknown
}

const globals = globalThis as unknown as Globals
const perf = typeof globals.performance?.mark === 'function' ? globals.performance : undefined

/** Records a point in time. Returns the mark's timestamp. */
export function mark(name: PerfName, detail?: Record<string, unknown>): number {
  if (!perf) return 0
  return perf.mark(name, detail ? { detail } : undefined).startTime
}

/**
 * Records a span on the Juno track. `start` is a mark name or a timestamp on
 * the `performance.now()` clock; the end is now unless given. `replace`
 * drops the earlier measures of that name first, for a measure taken on
 * every update: the buffer keeps the latest, which is the one tests read,
 * and a DevTools recording still shows each one.
 */
export function measure(
  name: PerfName,
  start: PerfName | number,
  options?: { readonly end?: number; readonly detail?: Record<string, unknown>; readonly replace?: boolean },
): void {
  if (!perf) return
  try {
    if (options?.replace) perf.clearMeasures?.(name)
    perf.measure(name, {
      start,
      end: options?.end ?? perf.now(),
      detail: { devtools: { dataType: 'track-entry', track: TRACK, properties: Object.entries(options?.detail ?? {}) } },
    })
  } catch {
    // A missing start mark is not worth a crash.
  }
}

/**
 * Converts an epoch-millisecond time from the engine to this process's
 * `performance.now()` clock, so a measure can start at the engine's `meta.at`.
 */
export function fromEpochMillis(epochMs: number): number {
  return perf ? epochMs - perf.timeOrigin : 0
}

/** Runs `f` at the first moment after a commit at which the frame has been presented. */
export function afterPaint(f: () => void): void {
  const raf = globals.requestAnimationFrame
  if (typeof raf !== 'function') return
  raf(() => setTimeout(f, 0))
}

export interface PerfCounters {
  readonly longFrames: number
  readonly slowEvents: number
  readonly entries: ReadonlyArray<EntryLike>
}

/**
 * Watches long animation frames (over 50 ms) and slow input events (over
 * 16 ms). Returns live counters; the renderer root exposes them for tests.
 */
export function observeFrames(): PerfCounters {
  const state = { longFrames: 0, slowEvents: 0, entries: [] as Array<EntryLike> }
  const Observer = globals.PerformanceObserver
  if (typeof Observer !== 'function') return state
  const record = (entry: EntryLike) => {
    if (entry.entryType === 'long-animation-frame') state.longFrames++
    else state.slowEvents++
    state.entries.push({ entryType: entry.entryType, name: entry.name, duration: entry.duration, startTime: entry.startTime })
    if (state.entries.length > 50) state.entries.shift()
  }
  try {
    new Observer((list) => list.getEntries().forEach(record)).observe({ type: 'long-animation-frame', buffered: true })
    new Observer((list) => list.getEntries().forEach(record)).observe({ type: 'event', buffered: true, durationThreshold: 16 })
  } catch {
    // Older Chromium without these entry types.
  }
  return state
}
