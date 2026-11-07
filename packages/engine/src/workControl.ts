import { Context, Effect, Queue, Stream } from 'effect'

/** Completed passes, including passes that decide there is nothing to do. */
export type WorkName = 'post' | 'action' | 'mark' | 'draft' | 'title' | 'art' | 'home' | 'automated' | 'slackSchedule' | 'presence'

/** Optional harness observation; no queues or extra passes in the app. */
export interface WorkControlOptions {
  /** Commands holding or waiting for the same target lock. */
  readonly onCommands?: (key: string, count: number) => void
  /** An action passed its initial checks and is about to request the send lane. */
  readonly onActionReady?: () => void
  readonly onPass?: (name: WorkName, event: 'started' | 'finished') => void
  readonly onWake?: (name: WorkName, wake: Effect.Effect<void> | undefined) => void
  /**
   * Draft sync writes from what it read earlier: a save's claim, or a list's absence (`before`, then `after`
   * the write). A test returns a promise at `before` to hold it there while something else lands; the write
   * reads again and must not send or delete from the stale read.
   */
  readonly onDraftWrite?: (step: 'claim' | 'absence', topicId: string, phase: 'before' | 'after') => Promise<void> | undefined
  /**
   * A live query that reports its runs: `read` when a run has read the store (`topics.list`, `allTopics.list`,
   * `allTopics.summary`, `prefs.get`), `tick` when the minute asks a list for a run. A test returns a promise at
   * `read` to hold the run there while something else lands: a write and a tick for a list, whose answer must never
   * be older than the one before it; a sign-in for a pref, whose answer the page must not take for another workspace's.
   */
  readonly onLiveRun?: (route: string, event: 'tick' | 'read') => Promise<void> | undefined
}

/** The query, telling a test's `onLiveRun` when it has read and waiting while the test holds it there. */
export const observeLiveRead = <A, E, R>(route: string, query: Effect.Effect<A, E, R>, control: WorkControlOptions): Effect.Effect<A, E, R> =>
  control.onLiveRun === undefined
    ? query
    : Effect.tap(query, () => {
        const hold = control.onLiveRun?.(route, 'read')
        return hold === undefined ? Effect.void : Effect.promise(() => hold)
      })

export class WorkControl extends Context.Reference<WorkControlOptions>('juno/engine/WorkControl', {
  defaultValue: () => ({}),
}) {}

/** Wraps the real pass, including its writes and early returns. */
export const observeWork = (name: WorkName) => <A, E, R>(pass: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const control = yield* WorkControl
    control.onPass?.(name, 'started')
    return yield* pass.pipe(Effect.tap(() => Effect.sync(() => control.onPass?.(name, 'finished'))))
  })

/** A test can request a pass through the same serial consumer as natural triggers. */
export const workWakes = (name: WorkName): Stream.Stream<void> => Stream.unwrap(Effect.map(WorkControl, (control) =>
  control.onWake === undefined ? Stream.empty : Stream.callback<void>(Effect.fn(function* (queue) {
    yield* Effect.acquireRelease(
      Effect.sync(() => control.onWake?.(name, Effect.asVoid(Queue.offer(queue, undefined)))),
      () => Effect.sync(() => control.onWake?.(name, undefined)),
    )
  }))))
