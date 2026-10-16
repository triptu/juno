/**
 * Tunables of the sync. A `Context.Reference` with defaults, so nothing has
 * to provide it; the engine and tests override the parts they need with
 * `syncConfigLayer({ ... })`. The numbers follow docs/architecture.md
 * section 5.
 */
import { Context, Layer } from 'effect'

export interface SyncConfigShape {
  /** Default quiet window when no quietDays preference is stored. The running sync observes that preference. */
  readonly quietDays: number
  /** Messages per `conversations.history` page. */
  readonly historyPageLimit: number
  /** Threads per `subscriptions.thread.getView` page. */
  readonly getViewPageLimit: number
  /** Unfollowed threads whose latest reply is fetched at cold boot so their row has a preview. */
  readonly previewThreads: number
  /** Ids per edge `users/info` call. */
  readonly usersChunk: number
  /** How long `nameUsers` waits after the first wanted id, so one call carries a burst. */
  readonly usersBatchMillis: number
  /** How often the discovery sweep runs while live. 0 disables the timer; reconnects still catch up. */
  readonly sweepIntervalMillis: number
  /**
   * The pass over the followed threads of the window (`followPass`) runs
   * with a catch-up or sweep at most this often after the last boot or pass.
   * 0 runs it with every catch-up.
   */
  readonly followPassMillis: number
  /** `search` uses `search.modules.messages`; `history` is the fallback of architecture 5.3. */
  readonly discovery: 'search' | 'history'
  /** Matches per search page and pages per sweep. */
  readonly searchPageCount: number
  readonly searchMaxPages: number
  /** Most history pages fetched for one conversation when catching up since a cursor. */
  readonly catchUpPages: number
  /** Wait before a failed boot is tried again. */
  readonly bootRetryMillis: number
  /**
   * The recheck after a drop or a restart (`recheck.ts`): at most this many
   * topics, the ones on screen first, then the most recently active, each
   * read back to `recheckLookbackMillis` before the gap began.
   */
  readonly recheckTopics: number
  readonly recheckLookbackMillis: number
}

export const defaultSyncConfig: SyncConfigShape = {
  quietDays: 7,
  historyPageLimit: 100,
  getViewPageLimit: 50,
  previewThreads: 50,
  usersChunk: 100,
  usersBatchMillis: 50,
  sweepIntervalMillis: 10 * 60_000,
  followPassMillis: 60 * 60_000,
  discovery: 'search',
  searchPageCount: 50,
  searchMaxPages: 3,
  catchUpPages: 5,
  bootRetryMillis: 30_000,
  recheckTopics: 10,
  recheckLookbackMillis: 24 * 60 * 60_000,
}

export const SyncConfig = Context.Reference<SyncConfigShape>('juno/sync/SyncConfig', {
  defaultValue: () => defaultSyncConfig,
})

export const syncConfigLayer = (overrides: Partial<SyncConfigShape> = {}): Layer.Layer<never> =>
  Layer.succeed(SyncConfig, { ...defaultSyncConfig, ...overrides })
