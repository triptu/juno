// The serve helpers: what a renderer sees for a sequence of query runs,
// including runs that fail, against scripted runs and against a real store.
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Cause, Effect, Exit, Layer, Queue, Schedule, Schema, Stream } from 'effect'
import { describe, expect, it } from 'bun:test'
import { invalidate, liveQuery, Store, StoreReader, StoreWriter, workspacePathsFromDir } from '@juno/store'
import { retryFirstRun, serveLiveList, serveLiveValue, timed, type ListRun } from '../src/protocol/live'

class QueryFailed extends Schema.TaggedError<QueryFailed>()('QueryFailed', { message: Schema.String }) {}

/** A stream of runs from a list of outcomes, shaped like the store's `liveQuery(keys, timed(query))`. */
const runsOf = <A>(outcomes: ReadonlyArray<A | Error>) =>
  Stream.fromIterable(outcomes).pipe(
    Stream.mapEffect((outcome) =>
      Effect.result(timed(outcome instanceof Error ? Effect.fail(new QueryFailed({ message: outcome.message })) : Effect.succeed(outcome as A))),
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

  it('sends nothing for a run whose value equals the last one; seq counts what was sent', async () => {
    const messages = await Effect.runPromise(serveLiveValue(runsOf([{ n: 1 }, { n: 1 }, { n: 2 }, { n: 2 }])).pipe(Stream.runCollect))
    expect(messages.map((m) => m.value)).toEqual([{ n: 1 }, { n: 2 }])
    expect(messages.map((m) => m.meta.seq)).toEqual([1, 2])
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

  it('sends nothing for a run that changed no row and kept the order', async () => {
    const a = { id: 'a', rev: 1, title: 'A' }
    const b = { id: 'b', rev: 1, title: 'B' }
    const deltas = await Effect.runPromise(
      serveLiveList(runsOf([window([a, b]), window([a, b]), window([b, a]), window([b, a])]), { encodeRow }).pipe(Stream.runCollect),
    )
    expect(deltas.map((d) => d.order)).toEqual([
      ['a', 'b'],
      ['b', 'a'],
    ])
    expect(deltas[1]).toMatchObject({ reset: false, upsert: [], remove: [], meta: { seq: 2 } })
  })

  it('fails the stream when the first run fails', async () => {
    const exit = await Effect.runPromiseExit(serveLiveList(runsOf<ListRun<Row>>([new Error('no table')]), { encodeRow }).pipe(Stream.runCollect))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe('retryFirstRun', () => {
  it('starts a stream again when its first run failed, and passes later values through', async () => {
    let attempts = 0
    const served = Stream.suspend(() => {
      attempts++
      return serveLiveValue(runsOf<number>(attempts < 3 ? [new Error('busy')] : [7, 8]))
    })
    const messages = await Effect.runPromise(served.pipe(retryFirstRun('probe', Schedule.spaced('1 millis')), Stream.runCollect))
    expect(attempts).toBe(3)
    expect(messages.map((m) => m.value)).toEqual([7, 8])
  })
})

describe('a live query on a real store', () => {
  const tempStore = Effect.acquireRelease(
    Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), 'juno-live-'))),
    (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
  )

  it('recovers from SQL errors: before the first value by retrying, after it by sending the error as a value', async () => {
    const program = Effect.gen(function* () {
      const writer = yield* StoreWriter
      const reader = yield* StoreReader
      const read = reader<{ v: number }>`SELECT v FROM probe`.pipe(Effect.map((rows) => rows[0]?.v ?? 0))
      const received = yield* Queue.unbounded<{ readonly value: number; readonly error: string | undefined }>()
      yield* serveLiveValue(liveQuery(['probe'], timed(read))).pipe(
        retryFirstRun('probe', Schedule.spaced('20 millis')),
        Stream.runForEach((message) => Queue.offer(received, { value: message.value, error: message.meta.error })),
        Effect.forkScoped,
      )
      // No table yet: the first runs fail, nothing is sent, and the subscription stays.
      yield* Effect.sleep('60 millis')
      expect(yield* Queue.size(received)).toBe(0)

      yield* writer`CREATE TABLE probe (v INTEGER)`
      yield* writer`INSERT INTO probe (v) VALUES (1)`
      expect(yield* Queue.take(received)).toEqual({ value: 1, error: undefined })

      // A failure after the first value: the last value again, with the error.
      yield* writer`DROP TABLE probe`
      yield* invalidate(['probe'])
      const failed = yield* Queue.take(received)
      expect(failed.value).toBe(1)
      expect(failed.error).toContain('no such table: probe')

      // The next good run clears it.
      yield* writer`CREATE TABLE probe (v INTEGER)`
      yield* writer`INSERT INTO probe (v) VALUES (2)`
      yield* invalidate(['probe'])
      expect(yield* Queue.take(received)).toEqual({ value: 2, error: undefined })
    })
    await Effect.runPromise(
      program.pipe(
        Effect.provide(Effect.map(tempStore, (dir) => Store.layer(workspacePathsFromDir(dir))).pipe((layer) => Layer.unwrap(layer))),
        Effect.scoped,
        Effect.timeout('20 seconds'),
      ),
    )
  })
})
