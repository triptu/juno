/**
 * Thumbnails for images stored without them (`files.ts`). Each file is
 * asked about with `files.info` on the background lane at most
 * `FILE_TRIES.length` times, after the waits listed, and a file event
 * (`file_thumbnail_generated`, `file_change`) asks at once instead of
 * waiting. Thumbnails in the answer go into every stored message that
 * carries the file, in one transaction. A file whose tries ran out is not
 * asked about again in this session unless an event names it.
 */
import { SlackApi } from '@juno/slack'
import { transaction } from '@juno/store'
import { Effect, FiberSet, Queue } from 'effect'
import type { SyncContext } from '../context'
import { hasThumbs } from '../files'
import { storeFileThumbs } from '../write'

/** The wait before each try. Live, `files.info` had the thumbnails 0.3 s after the share. */
const FILE_TRIES = [1_000, 3_000, 10_000, 30_000] as const
/** Files asked about at once; more wait for a later write of their message. */
const MAX_ACTIVE = 50
/** Files whose tries ran out, kept so an event can still ask about them. Oldest dropped. */
const MAX_SPENT = 200

interface Target {
  readonly channel: string
  readonly ts: string
}

interface Active {
  readonly targets: Map<string, Target>
  /** Sliding, capacity 1: an event wakes the next try early. */
  readonly wake: Queue.Queue<void>
}

export const refreshFiles = (ctx: SyncContext) =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const tries = yield* FiberSet.make()
    const active = new Map<string, Active>()
    const spent = new Map<string, Map<string, Target>>()

    /** Tries `fileId` until its thumbnails are stored, or the tries run out, or Slack says it is gone. */
    const ask = (fileId: string, entry: Active, waits: ReadonlyArray<number>) =>
      Effect.gen(function* () {
        for (const wait of waits) {
          yield* Effect.raceFirst(Effect.sleep(wait), Queue.take(entry.wake))
          const result = yield* Effect.result(api.call('files.info', { file: fileId }, { lane: 'background', reason: 'file' }))
          if (result._tag === 'Failure') {
            // A refusal (`file_not_found`, `file_deleted`) will not change; the session's end is someone else's to report.
            if (result.failure._tag === 'SlackRejected' || result.failure._tag === 'SlackAuthRequired') return 'gone' as const
            yield* Effect.logDebug('sync: file info failed', { tag: result.failure._tag })
            continue
          }
          const file = result.success.file
          if (!hasThumbs(file)) continue
          yield* transaction(storeFileThumbs(fileId, file, [...entry.targets.values()])).pipe(
            Effect.catchCause((cause) => Effect.logError('sync: file thumbnails not stored', { cause })),
          )
          return 'stored' as const
        }
        return 'spent' as const
      })

    const start = (fileId: string, targets: Map<string, Target>, waits: ReadonlyArray<number>) =>
      Effect.gen(function* () {
        const entry: Active = { targets, wake: yield* Queue.sliding<void>(1) }
        active.set(fileId, entry)
        yield* FiberSet.run(
          tries,
          ask(fileId, entry, waits).pipe(
            Effect.flatMap((outcome) =>
              Effect.sync(() => {
                active.delete(fileId)
                if (outcome !== 'spent') return
                spent.set(fileId, entry.targets)
                if (spent.size > MAX_SPENT) spent.delete(spent.keys().next().value!)
              }),
            ),
          ),
        )
      })

    while (true) {
      const fetch = yield* Queue.take(ctx.fileFetches)
      const running = active.get(fetch.fileId)
      if (fetch.kind === 'event') {
        if (running !== undefined) {
          yield* Queue.offer(running.wake, undefined)
          continue
        }
        // An event for a file whose tries ran out: one more try, now. One no stored message carries is not Juno's.
        const targets = spent.get(fetch.fileId)
        if (targets === undefined) continue
        spent.delete(fetch.fileId)
        yield* start(fetch.fileId, targets, [0])
        continue
      }
      const target = { channel: fetch.channel, ts: fetch.ts }
      if (running !== undefined) {
        running.targets.set(`${target.channel}:${target.ts}`, target)
        continue
      }
      const held = spent.get(fetch.fileId)
      if (held !== undefined) {
        held.set(`${target.channel}:${target.ts}`, target)
        continue
      }
      if (active.size >= MAX_ACTIVE) continue
      yield* start(fetch.fileId, new Map([[`${target.channel}:${target.ts}`, target]]), FILE_TRIES)
    }
  })
