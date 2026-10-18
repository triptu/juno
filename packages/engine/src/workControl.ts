import { Context, Effect, Queue, Stream } from 'effect'

/** Completed passes, including passes that decide there is nothing to do. */
export type WorkName = 'post' | 'action' | 'mark' | 'title' | 'art' | 'home' | 'automated' | 'slackSchedule'

/** Optional harness observation; no queues or extra passes in the app. */
export interface WorkControlOptions {
  /** Commands holding or waiting for the same target lock. */
  readonly onCommands?: (key: string, count: number) => void
  /** An action passed its initial checks and is about to request the send lane. */
  readonly onActionReady?: () => void
  readonly onPass?: (name: WorkName, event: 'started' | 'finished') => void
  readonly onWake?: (name: WorkName, wake: Effect.Effect<void> | undefined) => void
}

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
