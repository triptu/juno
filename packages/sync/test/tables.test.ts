/**
 * A table synced before Juno decoded tables is stored as the schema's
 * unknown variant (`{ type: 'unknown', raw }` in `blocks_json`). The index
 * upgrade on start re-reads those messages, so the row's preview names the
 * table without a resync.
 */
import { describe, expect } from 'bun:test'
import { itEffect } from '@juno/testing/effect'
import { Effect, Layer, Queue } from 'effect'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Message } from '@juno/slack-schema'
import { Store, StoreWriter, transaction, workspacePathsFromDir } from '@juno/store'
import type { UserId } from '@juno/domain'
import { reindexTopics, toMessageRow } from '../src/index'
import type { SyncContext } from '../src/context'
import { INDEX_VERSION, INDEX_VERSION_KEY, upgradeIndex } from '../src/upgrade'
import { getSyncState, setSyncState } from '../src/write/state'

const C = 'C0ENG'
const TOPIC = `m:${C}`
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

const cell = (text: string) => ({ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text }] }] })

/** A bot's message of only a table, as an older Juno stored it. */
const cachedTable = {
  type: 'message',
  ts: '1700000001.000100',
  bot_id: 'B0BOT',
  text: 'Release status',
  blocks: [{ type: 'unknown', raw: { type: 'table', rows: [[cell('Service'), cell('Status')], [cell('API'), cell('Healthy')]] } }],
} as unknown as Message

const preview = Effect.gen(function* () {
  const sql = yield* StoreWriter
  const rows = yield* sql<{ preview_json: string }>`SELECT preview_json FROM topic_index WHERE topic_id = ${TOPIC}`
  return (JSON.parse(rows[0]!.preview_json) as { text: string }).text
})

describe('tables in the cache', () => {
  itEffect('an index from before tables is rebuilt on start, and its preview names the table', () =>
    Effect.gen(function* () {
      const sql = yield* StoreWriter
      yield* sql`INSERT INTO messages ${sql.insert(toMessageRow(C, cachedTable) as unknown as Record<string, unknown>)}`
      yield* transaction(reindexTopics([TOPIC], { me: { userId: ME } }))
      expect(yield* preview).toBe('Table: Service, Status')

      // The index as the version before tables left it: the row stored Slack's fallback text.
      yield* sql`UPDATE topic_index SET preview_json = ${JSON.stringify({ sender: '', text: 'Release status' })} WHERE topic_id = ${TOPIC}`
      yield* setSyncState(INDEX_VERSION_KEY, 5)
      const ctx = { me: { userId: ME }, usergroupTopics: new Set(), missingUsers: new Map(), usersWanted: yield* Queue.sliding<void>(1) } as unknown as SyncContext
      expect(yield* upgradeIndex(ctx)).toBe(1)
      expect(yield* preview).toBe('Table: Service, Status')
      expect(yield* getSyncState<number>(INDEX_VERSION_KEY)).toBe(INDEX_VERSION)
    }).pipe(Effect.provide(store)))
})
