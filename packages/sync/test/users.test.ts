// Naming people: a person the store already has is never asked for again,
// so the users fiber sleeps once the names are in (the owner's idle-CPU
// report of 2026-10-16: a stored person mentioned in an older unread
// message re-indexed the topic every 50 ms, without end).
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Queue } from 'effect'
import { TestClock } from 'effect/testing'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { SlackEdge } from '@juno/slack'
import type { Message, User } from '@juno/slack-schema'
import { Store, StoreWriter, transaction, workspacePathsFromDir } from '@juno/store'
import type { UserId } from '@juno/domain'
import { reindexTopics, toMessageRow } from '../src/index'
import { defaultSyncConfig } from '../src/config'
import type { SyncContext } from '../src/context'
import { nameUsers, wantUsers } from '../src/users'
import { upsertUsers } from '../src/write/users'

const C = 'C0ENG'
const TOPIC = `m:${C}`
const ME = 'U0ME'
const MAYA = 'U0MAYA'
const LEO = 'U0LEO'
const NOBODY = 'U0NOBODY'

const store = Layer.unwrap(
  Effect.map(
    Effect.acquireRelease(
      Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), 'juno-sync-'))),
      (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
    ),
    (dir) => Store.layer(workspacePathsFromDir(dir)),
  ),
)

/** An edge that answers nothing and counts the calls: a stored person must never reach it. */
const countingEdge = (calls: { n: number }) =>
  Layer.succeed(
    SlackEdge,
    SlackEdge.of({
      usersInfo: (ids: ReadonlyArray<string>) =>
        Effect.sync(() => {
          calls.n++
          return { ok: true as const, results: [], failed_ids: [...ids] }
        }),
      call: () => Effect.die('not used'),
    } as unknown as Parameters<typeof SlackEdge.of>[0]),
  )

const user = (id: string, name: string): User => ({ id, name, profile: { display_name: name } }) as User

const insert = (ts: string, text: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const message = { type: 'message', ts, user: MAYA, text } as Message
    yield* sql`INSERT INTO messages ${sql.insert(toMessageRow(C, message) as unknown as Record<string, unknown>)}`
  })

/** Main of #eng, unread: Maya mentions Leo, then a newer message from Maya names nobody. */
const seed = Effect.gen(function* () {
  yield* transaction(upsertUsers([user(MAYA, 'Maya'), user(LEO, 'Leo')]))
  yield* insert('1700000001.000100', `<@${LEO}> can you look?`)
  yield* insert('1700000002.000100', 'thanks')
})

const context = (): Effect.Effect<SyncContext> =>
  Effect.gen(function* () {
    return {
      me: { userId: ME as UserId },
      config: { ...defaultSyncConfig, quietDays: 30 },
      rootFetches: yield* Queue.unbounded(),
      readLookups: yield* Queue.unbounded(),
      fileFetches: yield* Queue.unbounded(),
      missingUsers: new Map(),
      usersWanted: yield* Queue.sliding<void>(1),
      usersOnBackground: false,
      onSelfPresence: () => Effect.void,
      onHistory: () => Effect.void,
      onListed: Effect.void,
      unknownUsers: new Set(),
      usergroupTopics: new Set(),
      photoless: new Set(),
      lateReactions: new Map(),
      fetchesInFlight: new Set(),
      usersInFlight: new Map(),
      metadata: new Set(),
    } as SyncContext
  })

describe('naming people', () => {
  it.effect('a re-index reports only the people the store lacks, wherever the rule names them', () =>
    Effect.gen(function* () {
      yield* seed
      const asked: Array<string> = []
      yield* transaction(reindexTopics([TOPIC], { me: { userId: ME as UserId }, onMissingUser: (id) => asked.push(id) }))
      assert.deepStrictEqual(asked, [])

      // Someone the store has never seen, in an older unread message, is asked for.
      yield* insert('1700000000.000100', `<@${NOBODY}> joined`)
      yield* transaction(reindexTopics([TOPIC], { me: { userId: ME as UserId }, onMissingUser: (id) => asked.push(id) }))
      assert.deepStrictEqual(asked, [NOBODY])
    }).pipe(Effect.provide(store)))

  it.effect('the users fiber sleeps once a stored person has been asked about', () =>
    Effect.gen(function* () {
      yield* seed
      const ctx = yield* context()
      const calls = { n: 0 }
      const fiber = yield* Effect.forkChild(nameUsers(ctx).pipe(Effect.provide(countingEdge(calls))))
      // A page named Leo before his row was read: the fiber is asked once.
      wantUsers(ctx, [LEO], false, TOPIC)
      yield* TestClock.adjust('1 second')
      // Leo is stored, so nothing is fetched and nothing asks again.
      assert.strictEqual(calls.n, 0)
      assert.strictEqual(ctx.missingUsers.size, 0)
      assert.strictEqual(yield* Queue.size(ctx.usersWanted), 0)
      yield* TestClock.adjust('1 minute')
      assert.strictEqual(ctx.missingUsers.size, 0)
      assert.strictEqual(yield* Queue.size(ctx.usersWanted), 0)
      yield* Fiber.interrupt(fiber)
    }).pipe(Effect.provide(store)))
})
