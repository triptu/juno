// `Overflowed` means `SocketEvents` dropped events, which may include a
// `Connected`. The service must not take the connection for down after it,
// or running huddles would never be read again. An end-to-end overflow
// cannot be made on demand, so this drives the service's listener directly,
// with a Slack client that only answers `huddles/info`. Time is the
// TestClock's, so the settle window is the app's own and the checks that
// nothing was read are exact.
import { Context, Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, it } from 'bun:test'
import { SlackApi, SlackEdge } from '@juno/slack'
import { Huddle } from '../src/Huddle'
import { INFO_SETTLE_MILLIS } from '../src/core'
import { INFO_DEBOUNCE_MILLIS } from '../src/reads'

/** Moves virtual time on in small steps, so each woken fiber runs and sets its next timer inside the window. */
const advance = (millis: number) => Effect.gen(function* () {
  for (let left = millis; left > 0; left -= 10) yield* TestClock.adjust(Math.min(10, left))
})

const frame = { type: 'unknown', raw: { type: 'sh_room_update', huddle: { channel_id: 'C1' }, room: { id: 'R1', participants: ['U1'] } } } as const

it('reads running huddles after an overflow that dropped the reconnect', async () => {
  const reads: Array<number> = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const edge = SlackEdge.of({
      usersInfo: () => Effect.die('not used'),
      call: () => Effect.gen(function* () {
        reads.push(yield* Effect.clockWith((clock) => clock.currentTimeMillis))
        return { ok: true, huddles: [] } as never
      }),
    })
    const api = SlackApi.of({ call: () => Effect.die('not used'), upload: () => Effect.die('not used') })
    const huddle = yield* Huddle
    const listen = yield* huddle.attach({
      workspace: 'T1', selfId: 'U0ME',
      slack: Context.make(SlackEdge, edge).pipe(Context.add(SlackApi, api)),
      leaves: { read: Effect.succeed([]), write: () => Effect.void },
      channels: Effect.succeed(['C1']),
    })
    const settled = INFO_SETTLE_MILLIS + INFO_DEBOUNCE_MILLIS

    // A connect reads every channel once it has been quiet for the settle window.
    yield* listen({ _tag: 'Connected', fast: false })
    yield* advance(INFO_SETTLE_MILLIS - 1)
    expect(reads).toHaveLength(0)
    yield* advance(settled)
    expect(reads).toHaveLength(1)

    // A frame is already due when the socket reconnects. Its old deadline must not bypass the new quiet window.
    yield* listen({ _tag: 'Frame', receivedAt: 0, frame })
    yield* advance(INFO_SETTLE_MILLIS * 0.7)
    yield* listen({ _tag: 'Connected', fast: false })
    const reconnectedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
    yield* advance(INFO_SETTLE_MILLIS - 1)
    expect(reads).toHaveLength(1)
    yield* advance(settled)
    expect(reads).toHaveLength(2)
    expect(reads[1]! - reconnectedAt).toBeGreaterThanOrEqual(INFO_SETTLE_MILLIS)

    // The socket drops; Slack's frames meanwhile are lost, and so is the `Connected` after them. Reads go on.
    yield* listen({ _tag: 'Disconnected', reason: 'closed', retryInMillis: 1_000 })
    yield* listen({ _tag: 'Overflowed' })
    yield* advance(2 * settled)
    expect(reads).toHaveLength(3)

    // A drop the service saw does stop reads.
    yield* listen({ _tag: 'Disconnected', reason: 'closed', retryInMillis: 1_000 })
    yield* listen({ _tag: 'Frame', receivedAt: 0, frame })
    yield* advance(4 * settled)
    expect(reads).toHaveLength(3)
  }).pipe(Effect.provide(Huddle.layer), Effect.provide(TestClock.layer()))))
})
