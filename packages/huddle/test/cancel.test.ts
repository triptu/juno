// A Start cancelled while its answer is being stored, its engine connection
// still open: the user's Cancel during "Joining…". The cancel must win over
// the hand-off, or the record is held by a page that never got the
// credentials and blocks every later join. The window is the durable write,
// so this drives the service with a store whose write waits for the test.
import { Context, Deferred, Effect, Fiber, Ref } from 'effect'
import { expect, it } from 'vitest'
import type { HuddlePageReport } from '@juno/contract'
import { SlackApi, SlackEdge } from '@juno/slack'
import { Huddle } from '../src/Huddle'

const PAGE = 11
const CONNECTION = 7
const emptyReport: HuddlePageReport = { generation: PAGE, seq: 1, holds: null, received: null, connection: 'connected', muted: false, hasRemote: false, ended: null }

const until = (done: () => boolean) => Effect.sleep(20).pipe(Effect.repeat({ until: done }), Effect.timeoutOption(5_000))

it('hands nothing to a Start cancelled while its answer is stored, leaves its attendee, and joins again', async () => {
  const joins = { count: 0 }
  const leaves: Array<string> = []
  const api = SlackApi.of({
    call: (method, args, options) =>
      Effect.gen(function* () {
        if (method === 'rooms.join') {
          joins.count += 1
          return { call: { call_id: 'R1', free_willy: { meeting: {}, attendee: { AttendeeId: `A${joins.count}` } } } } as never
        }
        if (method === 'rooms.leave') {
          if (options?.beforeSend !== undefined) yield* options.beforeSend as Effect.Effect<void>
          leaves.push((args as { attendee_id: string }).attendee_id)
        }
        return {} as never
      }),
    upload: () => Effect.die('not used'),
  })
  const edge = SlackEdge.of({ usersInfo: () => Effect.die('not used'), call: () => Effect.succeed({ ok: true, huddles: [] } as never) })

  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const huddle = yield* Huddle
    const stored = yield* Ref.make<ReadonlyArray<unknown>>([])
    const writeStarted = yield* Deferred.make<void>()
    const writeMayFinish = yield* Deferred.make<void>()
    let holdNextWrite = true
    yield* Effect.forkChild(huddle.boot({ workspaces: Effect.succeed(['T1']), read: () => Effect.succeed([]) }))
    yield* huddle.attach({
      workspace: 'T1', selfId: 'U0ME',
      slack: Context.make(SlackEdge, edge).pipe(Context.add(SlackApi, api)),
      leaves: {
        read: Effect.succeed([]),
        write: (records) => Effect.gen(function* () {
          if (holdNextWrite) {
            holdNextWrite = false
            yield* Deferred.succeed(writeStarted, undefined)
            yield* Deferred.await(writeMayFinish)
          }
          yield* Ref.set(stored, records)
        }),
      },
      channels: Effect.succeed([]),
    })
    yield* huddle.pages([PAGE], PAGE)

    const starting = yield* Effect.forkChild(huddle.start('C1', null, PAGE, CONNECTION))
    yield* Deferred.await(writeStarted)
    // The user cancels while the answer is being stored; the connection stays open. The cancel must not wait for the store.
    yield* Effect.forkChild(Fiber.interrupt(starting))
    yield* Effect.sleep(50)
    yield* Deferred.succeed(writeMayFinish, undefined)
    // The page, on the same connection, holds nothing: it never got the credentials.
    yield* huddle.report(emptyReport, CONNECTION)
    yield* until(() => leaves.includes('A1'))
    expect(leaves).toEqual(['A1'])
    yield* Effect.sleep(300)
    expect(yield* Ref.get(stored)).toEqual([])

    // Nothing waits on the abandoned attendee: the next Start joins.
    const next = yield* huddle.start('C1', null, PAGE, CONNECTION)
    expect(next._tag).toBe('joined')
    expect(joins.count).toBe(2)
  }).pipe(Effect.provide(Huddle.layer))))
})
