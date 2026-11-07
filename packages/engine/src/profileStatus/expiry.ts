/**
 * When a status stops showing (`status.of`, docs/state-machines.md,
 * "Profile status expiry"): one wait per run toward the absolute expiry,
 * checked against the clock, never a poll.
 */
import type { ProfileStatus } from '@juno/contract'
import { Clock, Duration, Effect, Result, Stream } from 'effect'
import type { Run } from '../protocol/live'

/**
 * Waits until the clock reads `deadline`. A timer can end early or late
 * against the wall clock, and on a Mac that slept it ends late by the time
 * asleep, so each wake checks the clock and waits again for what is left;
 * `wakes` (the Mac woke) ends a wait early to check.
 */
export const reach = (deadline: number, wakes: Stream.Stream<void>): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (;;) {
      const now = yield* Clock.currentTimeMillis
      if (now >= deadline) return
      yield* Effect.raceFirst(Effect.sleep(Duration.millis(deadline - now)), Stream.runHead(wakes))
    }
  })

/**
 * A run whose status clears later, then the same run with no status at
 * that moment. One already past its expiry is sent as none.
 */
export const untilExpiry =
  (wakes: Stream.Stream<void>) =>
  <E>(run: Run<ProfileStatus | null, E>): Stream.Stream<Run<ProfileStatus | null, E>> => {
    if (run._tag === 'Failure') return Stream.succeed(run)
    const expiresAt = run.success.value?.expiresAt
    if (expiresAt === undefined) return Stream.succeed(run)
    const cleared: Run<ProfileStatus | null, E> = Result.succeed({ ...run.success, value: null })
    return Stream.unwrap(
      Effect.map(Clock.currentTimeMillis, (now) =>
        now >= expiresAt ? Stream.succeed(cleared) : Stream.concat(Stream.succeed(run), Stream.fromEffect(Effect.as(reach(expiresAt, wakes), cleared))),
      ),
    )
  }
