import { it } from '@effect/vitest'
import { expect } from 'vitest'
import { Clock, Effect, Fiber, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { runSync, syncConfigLayer } from '@juno/sync'
import { SlackSession } from '@juno/slack'
import { clientLayer, eventually, fakeSlack } from '../../slack/test/helpers'
import { freshStore } from '../../store/test/helpers'

it.effect('force_reload wakes a failed boot immediately and the next failure still backs off', () => Effect.gen(function* () {
  yield* TestClock.setTime(Date.UTC(2026, 9, 15))
  const fake = yield* fakeSlack
  fake.forceError({ method: 'client.userBoot', error: 'not_allowed', times: 2 })
  yield* Effect.gen(function* () {
    const starts: number[] = []
    let failures = 0
    let reloads = 0
    const fiber = yield* Effect.forkScoped(runSync({
      onPhase: (phase) => Effect.gen(function* () {
        if (phase._tag === 'booting') starts.push(yield* Clock.currentTimeMillis)
        if (phase._tag === 'offline') failures++
      }),
      onEvent: (event) => Effect.sync(() => {
        if (event._tag === 'Frame' && event.frame.type === 'force_reload') reloads++
      }),
    }))
    yield* eventually(() => failures === 1 && fake.socketCount() === 1)
    yield* TestClock.adjust(1000)
    const reloadedAt = yield* Clock.currentTimeMillis
    fake.emitFrame({ type: 'force_reload' })
    yield* eventually(() => reloads === 1 && starts.length === 2)
    expect(starts[1]).toBe(reloadedAt)
    yield* eventually(() => failures === 2)

    // The reload is consumed once. A second failure gets its full retry wait.
    yield* TestClock.adjust(29_999)
    expect(starts).toHaveLength(2)
    fake.forceError({ method: 'client.userBoot', error: 'invalid_auth' })
    yield* TestClock.adjust(1)
    yield* eventually(() => starts.length === 3)
    const result = yield* Effect.result(Fiber.join(fiber))
    expect(result).toMatchObject({ _tag: 'Failure', failure: { _tag: 'SlackAuthRequired' } })
    expect(starts[2]).toBe(reloadedAt + 30_000)
  }).pipe(Effect.provide(Layer.mergeAll(
    freshStore,
    SlackSession.layer({ ...fake.credentials(), workspaceUrl: fake.url }),
    clientLayer(fake, { socket: { pingIntervalMillis: 60_000 } }),
    syncConfigLayer({ bootRetryMillis: 30_000, sweepIntervalMillis: 0 }),
  )))
}).pipe(Effect.scoped))
