// A sign-out or workspace change in the middle of a call (specs/huddle.qnt,
// the stop barrier): the page may still run the old workspace's media, so
// the next workspace's join waits until that attendee is known stopped, and
// each workspace's leave goes out through its own Slack client only. The
// other schedules (a switch waits for the stop, a cancelled join's answer is
// a leave, a refused leave goes again, the restart barrier) run against the
// fake Slack in engine/test/flows/huddle-*.flow.test.ts.
import { Context, Deferred, Effect, Exit, Fiber, Scope, Stream } from 'effect'
import { expect, it } from 'bun:test'
import type { HuddlePageReport } from '@juno/contract'
import { SlackApi, SlackEdge } from '@juno/slack'
import { Huddle, type HuddleSession } from '../src/Huddle'

const PAGE = 11
const CONNECTION = 7
const report = (seq: number, holds: string | null, ended: HuddlePageReport['ended'] = null): HuddlePageReport =>
  ({ generation: PAGE, seq, holds, received: 'T1-A1', connection: holds === null ? null : 'connected', muted: false, hasRemote: false, ended }) as HuddlePageReport

/** A workspace's Slack client and store: its joins answer `<workspace>-A<n>`, and it records what it was asked. */
const workspace = (id: string) => Effect.gen(function* () {
  const joins: Array<string> = []
  const leaves: Array<string> = []
  const joined = yield* Deferred.make<void>()
  const api = SlackApi.of({
    call: (method, args, options) => Effect.gen(function* () {
      if (method === 'rooms.join') {
        joins.push((args as { channel_id?: string }).channel_id ?? '')
        yield* Deferred.succeed(joined, undefined)
        return { call: { call_id: `${id}-R`, free_willy: { meeting: {}, attendee: { AttendeeId: `${id}-A${joins.length}` } } } } as never
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
  const session: HuddleSession = {
    workspace: id, selfId: 'U0ME',
    slack: Context.make(SlackEdge, edge).pipe(Context.add(SlackApi, api)),
    leaves: { read: Effect.succeed([]), write: () => Effect.void },
    channels: Effect.succeed([]),
  }
  return { session, joins, leaves, joined }
})

it('a join in the next workspace waits until the page stopped the last one’s attendee', async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const huddle = yield* Huddle
    const t1 = yield* workspace('T1')
    const t2 = yield* workspace('T2')
    yield* Effect.forkChild(huddle.boot({ workspaces: Effect.succeed(['T1', 'T2']), read: () => Effect.succeed([]) }))
    yield* huddle.pages([PAGE], PAGE)

    // In a call in T1, its media running in the page.
    const first = yield* Scope.make()
    yield* huddle.attach(t1.session).pipe(Effect.provideService(Scope.Scope, first))
    const call = yield* huddle.start('C1', null, PAGE, CONNECTION)
    expect(call).toMatchObject({ _tag: 'joined', attendeeId: 'T1-A1' })
    yield* huddle.report(report(1, 'T1-A1'), CONNECTION)

    // The user signs out of T1 and into T2: T1's leave goes out through T1's client.
    yield* Scope.close(first, Exit.void)
    expect(t1.leaves).toEqual(['T1-A1'])
    yield* huddle.attach(t2.session)

    // A Start in T2 waits: the page still holds T1's attendee.
    const starting = yield* Effect.forkChild(huddle.start('C9', null, PAGE, CONNECTION))
    yield* huddle.call.pipe(Stream.filter((c) => c.phase === 'joining' && c.channelId === 'C9'), Stream.runHead)
    // A join the rules allowed would have been forked in the step just published; give it its turn.
    for (let i = 0; i < 5; i++) yield* Effect.yieldNow
    expect(t2.joins).toEqual([])

    // The page stops it: the join goes, through T2's client, and T2 never sends T1's leave.
    yield* huddle.report(report(2, null, { attendeeId: 'T1-A1', reason: 'left' }), CONNECTION)
    yield* Deferred.await(t2.joined)
    expect(yield* Fiber.join(starting)).toMatchObject({ _tag: 'joined', attendeeId: 'T2-A1' })
    expect(t2.joins).toEqual(['C9'])
    expect(t2.leaves).toEqual([])
  }).pipe(Effect.provide(Huddle.layer))))
})
