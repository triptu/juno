/**
 * `reindexTopics` keeps a row it computed while none of the row's inputs
 * change (`topic_inputs`). Whatever changes, a re-index must leave the row a
 * rebuild from scratch would give. Each step below changes one input the
 * way a writer does, re-indexes, and checks that a full rebuild
 * (`reindexAll`, which forgets every mark) changes nothing.
 */
import { describe, expect } from 'bun:test'
import { itEffect } from '@juno/testing/effect'
import { Effect, Layer } from 'effect'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Message } from '@juno/slack-schema'
import { Invalidation, Store, StoreWriter, transaction, workspacePathsFromDir } from '@juno/store'
import type { Me, UserId, UsergroupId } from '@juno/domain'
import { reindexAll, reindexTopics, toMessageRow } from '../src/index'
import { endEventCoverage, writeMessage } from '../src/write'

const C = 'C0ENG'
const MAIN = `m:${C}`
const ROOT = '1700000100.000100'
const R1 = '1700000200.000100'
const R2 = '1700000300.000100'
const THREAD = `t:${C}:${ROOT}`
const ME = 'U0ME' as UserId

const store = Layer.unwrap(
  Effect.map(
    Effect.acquireRelease(
      Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), 'juno-sync-'))),
      (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
    ),
    (dir) => Store.layer(workspacePathsFromDir(dir)),
  ),
)

const message = (fields: Readonly<Record<string, unknown>>): Message => ({ type: 'message', user: 'U0ANA', text: '', ...fields }) as unknown as Message
const root = () => message({ ts: ROOT, thread_ts: ROOT, user: 'U0BEN', text: 'See <#C0OPS> and <!subteam^S0DEV>, <@U0ANA>', reply_count: 2, latest_reply: R2 })

describe('re-indexing an unchanged topic', () => {
  itEffect('keeps no row a rebuild would change, whichever input changed', () =>
    Effect.gen(function* () {
      const sql = yield* StoreWriter
      let me: Me = { userId: ME, usergroupIds: [] }
      const ids = [MAIN, THREAD]
      const reindex = transaction(Effect.suspend(() => reindexTopics(ids, { me })))
      const rebuild = transaction(Effect.suspend(() => reindexAll({ me })))

      yield* sql`INSERT INTO users (id, name, display_name) VALUES ('U0ANA', 'ana', 'Ana'), ('U0BEN', 'ben', 'Ben')`
      yield* sql`INSERT INTO conversations (id, kind, name) VALUES (${C}, 'public', 'eng'), ('C0OPS', 'public', 'ops')`
      yield* sql`INSERT INTO usergroups (id, handle, name) VALUES ('S0DEV', 'dev', 'Developers')`
      yield* sql`INSERT INTO channel_reads (channel, has_unreads, mention_count) VALUES (${C}, 0, 0)`
      yield* sql`INSERT INTO thread_ranges (channel, thread_ts, kind, from_ts, to_ts, tail) VALUES (${C}, ${ROOT}, 'page', ${ROOT}, ${R1}, 'live')`
      const write = (m: Message) => transaction(writeMessage(toMessageRow(C, m)))
      yield* write(message({ ts: '1700000000.000100', text: 'Morning' }))
      yield* write(root())
      yield* write(message({ ts: R1, thread_ts: ROOT, text: 'First' }))
      yield* write(message({ ts: R2, thread_ts: ROOT, text: 'Second' }))
      expect(yield* reindex).toEqual(ids)
      expect(yield* reindex).toEqual([])
      expect(yield* rebuild).toEqual([])

      const steps: ReadonlyArray<readonly [string, Effect.Effect<unknown, unknown, StoreWriter | Invalidation>, ReadonlyArray<string>]> = [
        ['the same message stored again', write(message({ ts: R2, thread_ts: ROOT, text: 'Second' })), []],
        ['a reply edited', write(message({ ts: R2, thread_ts: ROOT, text: 'Second, edited', edited: { user: 'U0ANA', ts: '1700000400.000000' } })), [THREAD]],
        ['the sender renamed', sql`UPDATE users SET display_name = 'Anna' WHERE id = 'U0ANA'`, [MAIN, THREAD]],
        ['a mentioned group renamed', sql`UPDATE usergroups SET handle = 'devs' WHERE id = 'S0DEV'`, [MAIN]],
        ['a mentioned channel renamed', sql`UPDATE conversations SET name = 'ops-team' WHERE id = 'C0OPS'`, [MAIN]],
        ['a live tail held across a drop', sql`UPDATE thread_ranges SET tail = 'held'`, []],
        ['the tail ended', transaction(endEventCoverage), [THREAD]],
        ['the thread read', sql`INSERT INTO topic_reads (topic_id, last_read_ts) VALUES (${THREAD}, ${R2})`, [THREAD]],
        ['the user joined the mentioned group', Effect.sync(() => (me = { userId: ME, usergroupIds: ['S0DEV' as UsergroupId] })), [MAIN]],
        ['Slack reports newer activity in the channel', sql`UPDATE channel_reads SET latest = '1700000900.000100' WHERE channel = ${C}`, [MAIN]],
        ['a reply from someone not stored', write(message({ ts: '1700000500.000100', thread_ts: ROOT, user: 'U0CAT', text: 'Third' })), [THREAD]],
        ['that person stored', sql`INSERT INTO users (id, name, display_name) VALUES ('U0CAT', 'cat', 'Cat')`, [THREAD]],
        ['a reply deleted', sql`DELETE FROM messages WHERE ts = '1700000500.000100'`, [THREAD]],
      ]
      for (const [step, change, changed] of steps) {
        yield* change
        expect({ step, changed: yield* reindex }).toEqual({ step, changed })
        expect({ step, rebuilt: yield* rebuild }).toEqual({ step, rebuilt: [] })
      }
    }).pipe(Effect.provide(store)))
})
