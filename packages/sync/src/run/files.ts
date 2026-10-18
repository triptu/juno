/**
 * Files stored before Slack filled them in (`files.ts`): images without
 * thumbnails, videos without a poster, and partial copies. Each file is
 * asked about with `files.info` on the background lane at most
 * `FILE_TRIES.length` times, after the waits listed, and a file event
 * (`file_shared`, `file_change`, `file_created`, `file_thumbnail_generated`) asks at once
 * instead of waiting. If file info fails or is not ready, re-read the message
 * in the same attempt. The answer goes into every stored message that
 * carries the file, in one transaction. A file whose tries ran out is not
 * asked about again until an event names it or its topic is opened.
 *
 * Files come to be asked about two ways: a write of a recent message that
 * carries one (`pages.ts`), and an opened topic whose stored messages carry
 * one, however old (`queueTopicFiles`), so a card stored before Juno asked
 * becomes the picture once its topic is opened.
 */
import { SlackApi } from '@juno/slack'
import { StoreReader, transaction, type SqlError } from '@juno/store'
import { parseTopicId, type Ts } from '@juno/domain'
import { Effect, FiberSet, Queue } from 'effect'
import type { SyncContext } from '../context'
import { filesToFetch, isReady } from '../files'
import { storeFileInfo } from '../write'

/** The wait before each recovery attempt. Stop after four attempts. */
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

/** Re-read only this message, leaving history coverage, reactions and read state alone. */
const readFileMessage = (target: Target, fileId: string) =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const sql = yield* StoreReader
    const rows = yield* sql<{ thread_ts: Ts | null }>`SELECT thread_ts FROM messages
      WHERE channel = ${target.channel} AND ts = ${target.ts}`
    const row = rows[0]
    if (row === undefined) return undefined
    const args = { channel: target.channel, oldest: target.ts, latest: target.ts, inclusive: true, limit: 2 }
    // Replies include the root too; select the exact message before taking its file.
    const page = yield* row.thread_ts !== null && row.thread_ts !== target.ts
      ? api.call('conversations.replies', { ...args, ts: row.thread_ts }, { lane: 'background', reason: 'file' })
      : api.call('conversations.history', args, { lane: 'background', reason: 'file' })
    return page.messages.find((message) => message.ts === target.ts)?.files?.find((file) => file.id === fileId)
  })

/** Prefer file info when available, with an exact message read as the fallback. */
const readReadyFile = (target: Target, fileId: string) =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const info = yield* Effect.result(api.call('files.info', { file: fileId }, { lane: 'background', reason: 'file' }))
    if (info._tag === 'Success' && isReady(info.success.file)) return info.success.file
    return yield* readFileMessage(target, fileId)
  })

export const refreshFiles = (ctx: SyncContext) =>
  Effect.gen(function* () {
    const tries = yield* FiberSet.make()
    const active = new Map<string, Active>()
    const spent = new Map<string, Map<string, Target>>()

    /** Tries `fileId` until its thumbnails are stored, or the tries run out, or Slack says it is gone. */
    const ask = (fileId: string, entry: Active, waits: ReadonlyArray<number>) =>
      Effect.gen(function* () {
        for (const wait of waits) {
          yield* Effect.raceFirst(Effect.sleep(wait), Queue.take(entry.wake))
          const target = entry.targets.values().next().value
          if (target === undefined) return 'gone' as const
          const result = yield* Effect.result(readReadyFile(target, fileId))
          if (result._tag === 'Failure') {
            // A refused message read will not change; the session's end is someone else's to report.
            if (result.failure._tag === 'SlackRejected' || result.failure._tag === 'SlackAuthRequired') return 'gone' as const
            yield* Effect.logDebug('sync: file message read failed', { tag: result.failure._tag })
            continue
          }
          const file = result.success
          if (file === undefined || !isReady(file)) continue
          yield* transaction(storeFileInfo(fileId, file, [...entry.targets.values()]))
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
            Effect.catchCause((cause) => Effect.logError('sync: file recovery failed', { cause }).pipe(Effect.as('spent' as const))),
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
      const targets = spent.get(fetch.fileId) ?? new Map<string, Target>()
      targets.set(`${target.channel}:${target.ts}`, target)
      if (spent.has(fetch.fileId) && fetch.kind === 'stored') continue
      if (active.size >= MAX_ACTIVE) continue
      spent.delete(fetch.fileId)
      yield* start(fetch.fileId, targets, FILE_TRIES)
    }
  })

/** The stored messages of an opened topic the check reads, newest first. */
const TOPIC_FILES_LIMIT = 200

/** Queues the files the newest stored messages of `topicId` carry that Slack has not filled in. */
export const queueTopicFiles = (ctx: SyncContext, topicId: string): Effect.Effect<void, SqlError, StoreReader> =>
  Effect.gen(function* () {
    const parsed = parseTopicId(topicId)
    if (parsed === undefined) return
    const sql = yield* StoreReader
    // Through `messages (channel, thread_ts, ts)`: Main's own messages, or one thread's.
    const rows =
      parsed.kind === 'main'
        ? yield* sql<{ ts: string; files_json: string }>`SELECT ts, files_json FROM messages
            WHERE channel = ${parsed.channel} AND thread_ts IS NULL AND files_json IS NOT NULL ORDER BY ts DESC LIMIT ${TOPIC_FILES_LIMIT}`
        : yield* sql<{ ts: string; files_json: string }>`SELECT ts, files_json FROM messages
            WHERE channel = ${parsed.channel} AND thread_ts = ${parsed.threadTs} AND files_json IS NOT NULL ORDER BY ts DESC LIMIT ${TOPIC_FILES_LIMIT}`
    for (const row of rows) {
      for (const fileId of filesToFetch(row.files_json)) yield* Queue.offer(ctx.fileFetches, { kind: 'opened', fileId, channel: parsed.channel, ts: row.ts })
    }
  })

