/**
 * The engine's configuration as a service, built from the `EngineConfig`
 * main sends over parentPort (or a test passes to `startEngine`).
 */
import type { SocketEvent } from '@juno/slack'
import { Context, Layer } from 'effect'
import type { SyncConfigShape } from '@juno/sync'
import type { EngineConfig as Config } from '@juno/contract'

export class EngineConfig extends Context.Service<EngineConfig, Config>()('juno/engine/EngineConfig') {
  static readonly layer = (config: Config): Layer.Layer<EngineConfig> => Layer.succeed(EngineConfig, config)
}

/** Host controls for observing sync cycles and the socket, and overriding their schedule. */
export interface SyncControlOptions {
  readonly config?: Partial<Omit<SyncConfigShape, 'bootRetryMillis' | 'usersBatchMillis' | 'fileRetryMillis' | 'sweepIntervalMillis' | 'followPassMillis'>>
  /** Observes socket events through a subscriber after the sync write attempt. */
  readonly onEvent?: (event: SocketEvent) => void
  readonly onCycle?: (event: 'started' | 'finished') => void
  /** Called when the outbox workers learn that the socket is up or down (`SyncLink.online`). */
  readonly onConnection?: (online: boolean) => void
}

export class SyncControl extends Context.Reference<SyncControlOptions>('juno/engine/SyncControl', {
  defaultValue: () => ({}),
}) {}

/** Scheduling only: data ages, server Retry-After and request budgets keep their real meaning. */
export interface EngineTimingConfig {
  /** Maximum initial hold while Automated classifies a channel. */
  readonly automatedHoldMillis: number
  /** First retry delay; each failed attempt doubles it. */
  readonly retryBaseMillis: number
  /** Longest outbox retry delay. */
  readonly retryCapMillis: number
  /** Initial delay between follow and read reconciliation lookups. */
  readonly lookupRetryMillis: number
  /** Wait after a lost send answer before looking up the message. */
  readonly postSettleMillis: number
  /** Wait before retrying a row without a session. */
  readonly noSessionMillis: number
  /** Wait after a failed worker pass. */
  readonly workerRetryMillis: number
  /** Maximum wait for catch-up before deleting a duplicate. */
  readonly copyCatchUpMillis: number
  /** Wait before checking a blocked action dependency again. */
  readonly dependencyPollMillis: number
  /** Age at which an unsent action is shown as stalled. */
  readonly actionStallMillis: number
  /** Maximum pending action age between calls. */
  readonly actionDeadlineMillis: number
  /** Read mark coalescing window. */
  readonly markDelayMillis: number
  /** Quiet window before writing notification hours to Slack. */
  readonly slackScheduleDebounceMillis: number
  /** Quiet window before a title pass. */
  readonly titleDebounceMillis: number
  /** Periodic title pass cadence. */
  readonly titleTickMillis: number
  /** Wait before reconsidering a title without an answer. */
  readonly titleDeferMillis: number
  /** Quiet window before an art pass. */
  readonly artDebounceMillis: number
  /** Initial wait before retrying an unsuccessful AI job. */
  readonly aiDeferBaseMillis: number
  /** Longest retry wait for topic art. */
  readonly artDeferCapMillis: number
  /** Art retry wait when no model key is available. */
  readonly artNoKeyMillis: number
  /** Window gathering Home job changes. */
  readonly homeWindowMillis: number
  /** Periodic Home job cadence. */
  readonly homeTickMillis: number
  /** Longest retry wait for Home and Automated jobs. */
  readonly aiDeferCapMillis: number
  /** Window gathering Automated job changes. */
  readonly automatedWindowMillis: number
  /** Periodic Automated job cadence. */
  readonly automatedTickMillis: number
  /** Wait before retrying failed sync work. */
  readonly bootRetryMillis: number
  /** Window gathering missing users into one request. */
  readonly usersBatchMillis: number
  /** First thumbnail recovery wait; subsequent waits keep their production ratios. */
  readonly fileRetryMillis: number
  /** Periodic discovery cadence; zero disables periodic sweeps. */
  readonly sweepIntervalMillis: number
  /** Minimum time between full follow passes; zero checks every catch-up. */
  readonly followPassMillis: number
  /** Socket ping interval. */
  readonly socketPingMillis: number
  /** Maximum time without a pong before reconnecting. */
  readonly socketPongTimeoutMillis: number
  /** Maximum connect time before hello. */
  readonly socketHelloTimeoutMillis: number
  /** First socket reconnect backoff. */
  readonly socketBackoffBaseMillis: number
  /** Longest socket reconnect backoff. */
  readonly socketBackoffCapMillis: number
  /** Minimum time between socket activity tickles. */
  readonly socketTickleMillis: number
  /** First HTTP transient retry backoff. */
  readonly slackRetryBaseMillis: number
  /** Longest HTTP transient retry backoff. */
  readonly slackRetryCapMillis: number
  /** First retry of a failed live query. */
  readonly liveRetryBaseMillis: number
  /** Longest retry of a failed live query. */
  readonly liveRetryCapMillis: number
  /** How often the "In a huddle" status is renewed while a call is live (±10%). */
  readonly huddleStatusRenewMillis: number
  /** How long the user may be alone in a huddle before Juno leaves it (SPEC 20). */
  readonly huddleAloneMillis: number
}

export const productionTiming: EngineTimingConfig = {
  automatedHoldMillis: 5_000,
  retryBaseMillis: 1_000,
  retryCapMillis: 300_000,
  lookupRetryMillis: 1_000,
  postSettleMillis: 2_000,
  noSessionMillis: 5_000,
  workerRetryMillis: 5_000,
  copyCatchUpMillis: 120_000,
  dependencyPollMillis: 250,
  actionStallMillis: 3_000,
  actionDeadlineMillis: 300_000,
  markDelayMillis: 400,
  slackScheduleDebounceMillis: 1_000,
  titleDebounceMillis: 1_500,
  titleTickMillis: 30_000,
  titleDeferMillis: 60_000,
  artDebounceMillis: 1_500,
  aiDeferBaseMillis: 60_000,
  artDeferCapMillis: 1_800_000,
  artNoKeyMillis: 600_000,
  homeWindowMillis: 3_000,
  homeTickMillis: 900_000,
  aiDeferCapMillis: 3_600_000,
  automatedWindowMillis: 3_000,
  automatedTickMillis: 900_000,
  bootRetryMillis: 30_000,
  usersBatchMillis: 50,
  fileRetryMillis: 1_000,
  sweepIntervalMillis: 600_000,
  followPassMillis: 3_600_000,
  socketPingMillis: 10_000,
  socketPongTimeoutMillis: 30_000,
  socketHelloTimeoutMillis: 15_000,
  socketBackoffBaseMillis: 1_000,
  socketBackoffCapMillis: 60_000,
  socketTickleMillis: 19_000,
  slackRetryBaseMillis: 1_000,
  slackRetryCapMillis: 15_000,
  liveRetryBaseMillis: 500,
  liveRetryCapMillis: 30_000,
  huddleStatusRenewMillis: 240_000,
  huddleAloneMillis: 600_000,
}

export class EngineTiming extends Context.Reference<EngineTimingConfig>('juno/engine/EngineTiming', {
  defaultValue: () => productionTiming,
}) {}
