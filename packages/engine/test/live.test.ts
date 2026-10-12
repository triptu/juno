// The serve helpers: what a renderer sees for a sequence of query runs,
// including runs that fail.
import { Cause, Effect, Exit, Schema, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { serveLiveList, serveLiveValue, timed, type ListRun } from '../src/index'

class QueryFailed extends Schema.TaggedError<QueryFailed>()('QueryFailed', { message: Schema.String }) {}

/** A stream of runs from a list of outcomes: a value, or `Error` for a failed run. */
const runsOf = <A>(outcomes: ReadonlyArray<A | Error>) =>
  Stream.fromIterable(outcomes).pipe(
    Stream.mapEffect((outcome) =>
      timed(outcome instanceof Error ? Effect.fail(new QueryFailed({ message: outcome.message })) : Effect.succeed(outcome as A)),
    ),
  )

describe('serveLiveValue', () => {
  it('numbers every message and stamps the engine clock', async () => {
    const messages = await Effect.runPromise(serveLiveValue(runsOf([1, 2, 3])).pipe(Stream.runCollect))
    expect(messages.map((m) => m.value)).toEqual([1, 2, 3])
    expect(messages.map((m) => m.meta.seq)).toEqual([1, 2, 3])
    for (const message of messages) expect(message.meta.at).toBeGreaterThan(0)
  })

  it('keeps the subscription alive through a failed run, showing the last value with the error', async () => {
    const messages = await Effect.runPromise(serveLiveValue(runsOf([1, new Error('db locked'), 2])).pipe(Stream.runCollect))
    expect(messages.map((m) => m.value)).toEqual([1, 1, 2])
    expect(messages[1]!.meta.error).toContain('db locked')
    expect(messages[2]!.meta.error).toBeUndefined()
    expect(messages.map((m) => m.meta.seq)).toEqual([1, 2, 3])
  })

  it('fails the stream when the first run fails, so the route error reaches the renderer', async () => {
    const exit = await Effect.runPromiseExit(serveLiveValue(runsOf<number>([new Error('no table'), 1])).pipe(Stream.runCollect))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toMatchObject({ _tag: 'QueryFailed', message: 'no table' })
  })
})

describe('serveLiveList', () => {
  const Row = Schema.Struct({ id: Schema.String, rev: Schema.Int, title: Schema.String })
  type Row = typeof Row.Type
  const encodeRow = Schema.encodeSync(Schema.toCodecJson(Row))
  const window = (rows: ReadonlyArray<Row>): ListRun<Row> => ({ rows, total: rows.length })

  it('sends the window first, then only rows whose rev changed', async () => {
    const deltas = await Effect.runPromise(
      serveLiveList(
        runsOf([
          window([
            { id: 'a', rev: 1, title: 'A' },
            { id: 'b', rev: 1, title: 'B' },
          ]),
          window([
            { id: 'b', rev: 2, title: 'B2' },
            { id: 'c', rev: 1, title: 'C' },
          ]),
        ]),
        { encodeRow },
      ).pipe(Stream.runCollect),
    )
    expect(deltas[0]).toMatchObject({ reset: true, order: ['a', 'b'], remove: [], meta: { seq: 1, total: 2 } })
    expect(deltas[0]!.upsert.map((r) => r.id)).toEqual(['a', 'b'])
    expect(deltas[1]).toMatchObject({ reset: false, order: ['b', 'c'], remove: ['a'], meta: { seq: 2 } })
    expect(deltas[1]!.upsert.map((r) => r.id)).toEqual(['b', 'c'])
  })

  it('keeps the window through a failed run and resumes diffing against it', async () => {
    const deltas = await Effect.runPromise(
      serveLiveList(
        runsOf([
          window([{ id: 'a', rev: 1, title: 'A' }]),
          new Error('db locked'),
          window([
            { id: 'a', rev: 1, title: 'A' },
            { id: 'b', rev: 1, title: 'B' },
          ]),
        ]),
        { encodeRow },
      ).pipe(Stream.runCollect),
    )
    expect(deltas[1]).toMatchObject({ reset: false, order: ['a'], upsert: [], remove: [] })
    expect(deltas[1]!.meta.error).toContain('db locked')
    // Only the new row travels: 'a' did not change across the failure.
    expect(deltas[2]!.upsert.map((r) => r.id)).toEqual(['b'])
    expect(deltas[2]!.meta.error).toBeUndefined()
  })

  it('fails the stream when the first run fails', async () => {
    const exit = await Effect.runPromiseExit(serveLiveList(runsOf<ListRun<Row>>([new Error('no table')]), { encodeRow }).pipe(Stream.runCollect))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('measures encoding only when asked', async () => {
    const rows = [window([{ id: 'a', rev: 1, title: 'A' }])]
    const [plain] = await Effect.runPromise(serveLiveList(runsOf(rows), { encodeRow }).pipe(Stream.runCollect))
    const [measured] = await Effect.runPromise(serveLiveList(runsOf(rows), { encodeRow, measure: true }).pipe(Stream.runCollect))
    expect(plain!.meta.encodeMs).toBe(0)
    expect(measured!.meta.encodeMs).toBeGreaterThan(0)
  })
})
