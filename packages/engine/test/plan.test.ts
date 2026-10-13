// Every sidebar statement has an index (performance 6): the plan may not
// scan messages, topic_index, reactions or topic_overlay.
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Store, StoreReader, workspacePathsFromDir, type StoreError } from '@juno/store'
import { countsStatement, listStatements, type ListFilter } from '../src/topics/query'

const tempDir = Effect.acquireRelease(
  Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), 'juno-plan-'))),
  (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
)
const freshStore: Layer.Layer<Layer.Success<ReturnType<typeof Store.layer>>, StoreError> = Layer.unwrap(
  Effect.map(tempDir, (dir) => Store.layer(workspacePathsFromDir(dir))),
)

/** Table aliases the statements use, back to the tables the rule names. */
const ALIASES: Record<string, string> = { i: 'topic_index', o: 'topic_overlay', m: 'messages' }
const GUARDED = new Set(['messages', 'topic_index', 'reactions', 'topic_overlay'])

const plan = (sql: string, params: ReadonlyArray<unknown>) =>
  Effect.gen(function* () {
    const reader = yield* StoreReader
    const rows = yield* reader.unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)
    return rows.map((r) => r.detail)
  })

const scans = (lines: ReadonlyArray<string>) =>
  lines.filter((line) => {
    const match = /^SCAN (\S+)/.exec(line)
    if (match === null) return false
    const table = ALIASES[match[1]!] ?? match[1]!
    return GUARDED.has(table)
  })

const filters: ReadonlyArray<ListFilter> = [
  { kind: 'all', unreadOnly: false },
  { kind: 'channels', unreadOnly: false },
  { kind: 'dms', unreadOnly: true },
  { kind: 'all', unreadOnly: false, scope: 'C0ENG' },
  { kind: 'all', unreadOnly: true, scope: 'C0ENG' },
]

describe('query plans', () => {
  it.effect('topics.list never scans the guarded tables, for every filter', () =>
    Effect.gen(function* () {
      for (const filter of filters) {
        for (const statement of listStatements(filter, '1700000000.000000', 300)) {
          const lines = yield* plan(statement.sql, statement.params)
          assert.deepStrictEqual(scans(lines), [], `${JSON.stringify(filter)}\n${lines.join('\n')}`)
          assert.isTrue(lines.some((line) => line.includes('topic_index')), 'the window comes from a topic_index index')
        }
      }
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('topics.counts never scans the guarded tables', () =>
    Effect.gen(function* () {
      for (const scope of [undefined, 'C0ENG']) {
        const statement = countsStatement(scope)
        const lines = yield* plan(statement.sql, statement.params)
        assert.deepStrictEqual(scans(lines), [], lines.join('\n'))
      }
    }).pipe(Effect.provide(freshStore)),
  )
})
