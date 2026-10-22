// `Overflowed` means `SocketEvents` dropped events, which may include a
// `Connected`. The service must not take the connection for down after it,
// or running huddles would never be read again. An end-to-end overflow
// cannot be made on demand, so this drives the service's listener directly,
// with a Slack client that only answers `huddles/info`.
import { Context, Effect } from 'effect'
import { expect, it } from 'vitest'
import { SlackApi, SlackEdge } from '@juno/slack'
import { Huddle } from '../src/Huddle'

it('reads running huddles after an overflow that dropped the reconnect', async () => {
  const reads: Array<ReadonlyArray<string>> = []
  const edge = SlackEdge.of({
    usersInfo: () => Effect.die('not used'),
    call: (_method, body) =>
      Effect.sync(() => {
        reads.push(body['channel_ids'] as ReadonlyArray<string>)
        return { ok: true, huddles: [] } as never
      }),
  })
  const api = SlackApi.of({ call: () => Effect.die('not used'), upload: () => Effect.die('not used') })
  const readsAfter = (count: number) => Effect.sleep(50).pipe(Effect.repeat({ until: () => reads.length >= count }), Effect.timeoutOption(5_000))

  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const huddle = yield* Huddle
    const listen = yield* huddle.attach({
      workspace: 'T1', selfId: 'U0ME',
      slack: Context.make(SlackEdge, edge).pipe(Context.add(SlackApi, api)),
      leaves: { read: Effect.succeed([]), write: () => Effect.void },
      channels: Effect.succeed(['C1']),
      infoSettleMillis: 1_000,
    })
    yield* listen({ _tag: 'Connected', fast: false })
    yield* readsAfter(1)
    expect(reads).toHaveLength(1)

    // A frame is already due when the socket reconnects. Its old deadline
    // must not bypass the new quiet window for the reconnect.
    yield* listen({ _tag: 'Frame', receivedAt: 0, frame: { type: 'unknown', raw: { type: 'sh_room_update', huddle: { channel_id: 'C1' }, room: { id: 'R1', participants: ['U1'] } } } })
    yield* Effect.sleep(700)
    yield* listen({ _tag: 'Connected', fast: false })
    yield* Effect.sleep(500)
    expect(reads).toHaveLength(1)
    yield* readsAfter(2)

    // The socket drops; Slack's frames meanwhile are lost, and so is the `Connected` after them.
    yield* listen({ _tag: 'Disconnected', reason: 'closed', retryInMillis: 1_000 })
    yield* listen({ _tag: 'Overflowed' })
    yield* readsAfter(3)
    expect(reads).toHaveLength(3)

    // A drop the service saw does stop reads.
    yield* listen({ _tag: 'Disconnected', reason: 'closed', retryInMillis: 1_000 })
    yield* listen({ _tag: 'Frame', receivedAt: 0, frame: { type: 'unknown', raw: { type: 'sh_room_update', huddle: { channel_id: 'C1' }, room: { id: 'R1', participants: ['U1'] } } } })
    yield* Effect.sleep(500)
    expect(reads).toHaveLength(3)
  }).pipe(Effect.provide(Huddle.layer))))
}, 10_000)
