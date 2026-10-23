// A Start cancelled while its answer is being stored, its engine connection
// still open: the user's Cancel during "Joining…". The cancel must win over
// the hand-off, or the record is held by a page that never got the
// credentials and blocks every later join. The window is the durable write,
// so this drives the service with a store whose write waits for the test.
// Every wait is on a signal; the test's timeout bounds them.
import { Context, Deferred, Effect, Fiber, Ref } from 'effect'
import { expect, it } from 'bun:test'
import type { HuddlePageReport } from '@juno/contract'
import { SlackApi, SlackEdge } from '@juno/slack'
import { Huddle } from '../src/Huddle'

const PAGE = 11
const CONNECTION = 7
const emptyReport: HuddlePageReport = { generation: PAGE, seq: 1, holds: null, received: null, connection: 'connected', muted: false, hasRemote: false, ended: null }

it('hands nothing to a Start cancelled while its answer is stored, leaves its attendee, and joins again', async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const joins = { count: 0 }
    const leaves: Array<string> = []
    const left = yield* Deferred.make<void>()
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
            yield* Deferred.succeed(left, undefined)
          }
          return {} as never
        }),
      upload: () => Effect.die('not used'),
    })
    const edge = SlackEdge.of({ usersInfo: () => Effect.die('not used'), call: () => Effect.succeed({ ok: true, huddles: [] } as never) })

    const huddle = yield* Huddle
    const stored = yield* Ref.make<ReadonlyArray<unknown>>([])
    const writeStarted = yield* Deferred.make<void>()
    const writeMayFinish = yield* Deferred.make<void>()
    // The stored list goes back to empty after holding the answer's record.
    const cleared = yield* Deferred.make<void>()
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
          const before = yield* Ref.getAndSet(stored, records)
          if (before.length > 0 && records.length === 0) yield* Deferred.succeed(cleared, undefined)
        }),
      },
      channels: Effect.succeed([]),
    })
    yield* huddle.pages([PAGE], PAGE)

    const starting = yield* Effect.forkChild(huddle.start('C1', null, PAGE, CONNECTION))
    yield* Deferred.await(writeStarted)
    // The user cancels while the answer is being stored; the connection stays open. The cancel returns
    // while the write is still held: it does not wait for the store.
    yield* Fiber.interrupt(starting)
    yield* Deferred.succeed(writeMayFinish, undefined)
    // The page, on the same connection, holds nothing: it never got the credentials.
    yield* huddle.report(emptyReport, CONNECTION)
    yield* Deferred.await(left)
    expect(leaves).toEqual(['A1'])
    yield* Deferred.await(cleared)

    // Nothing waits on the abandoned attendee: the next Start joins.
    const next = yield* huddle.start('C1', null, PAGE, CONNECTION)
    expect(next._tag).toBe('joined')
    expect(joins.count).toBe(2)
    expect(leaves).toEqual(['A1'])
  }).pipe(Effect.provide(Huddle.layer))))
})
