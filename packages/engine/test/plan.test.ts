// Every live query statement has an index (performance 6): the plan may not
// scan messages, topic_index, reactions or topic_overlay. The sidebar's
// statements, and the topic view's: the Main and thread windows, their
// reactions and thread titles, a channel's active threads, and the New chat
// pickers, All topics (its order, counts and places), and ⌘K's local search.
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Store, StoreReader, workspacePathsFromDir, type StoreError } from '@juno/store'
import { reactionsStatement, rootStatement, threadsStatements, threadTitlesStatement, windowStatements, type WindowTarget } from '../src/messages/window'
import { homeStatements } from '../src/home/query'
import { staleStatement } from '../src/home/job'
import { automatedStatements } from '../src/automatedView'
import { activityStatement, frequentConversationsStatement, frequentSendsStatement, pickerStatements } from '../src/newchat/query'
import { mentionStatements } from '../src/mentions/query'
import { searchStatements } from '../src/search/query'
import { countsStatement as allTopicsCountsStatement, orderStatement, placesStatement } from '../src/topics/allTopics'
import { countsStatement, listStatements, type ListFilter } from '../src/topics/query'

const tempDir = Effect.acquireRelease(
  Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), 'juno-plan-'))),
  (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
)
const freshStore: Layer.Layer<Layer.Success<ReturnType<typeof Store.layer>>, StoreError> = Layer.unwrap(
  Effect.map(tempDir, (dir) => Store.layer(workspacePathsFromDir(dir))),
)

/** Table aliases the statements use, back to the tables the rule names. */
const ALIASES: Record<string, string> = { i: 'topic_index', t: 'topic_index', ti: 'topic_index', o: 'topic_overlay', ov: 'topic_overlay', m: 'messages' }
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
  { kind: 'all', unreadOnly: false, view: 'vbots' },
  { kind: 'all', unreadOnly: true, view: 'vbots' },
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
        // Unscoped (a view included), Pinned and older unread rows come through their own partial indexes, never every topic of a channel.
        if (filter.scope === undefined) {
          const [, pinned, unread] = listStatements(filter, '1700000000.000000', 300)
          const pinnedLines = yield* plan(pinned!.sql, pinned!.params)
          assert.isTrue(pinnedLines.some((line) => line.includes('topic_overlay_pinned')), `${JSON.stringify(filter)} pinned\n${pinnedLines.join('\n')}`)
          const unreadLines = yield* plan(unread!.sql, unread!.params)
          assert.isTrue(unreadLines.some((line) => line.includes('topic_index_unread')), `${JSON.stringify(filter)} unread\n${unreadLines.join('\n')}`)
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

  it.effect('allTopics.list and allTopics.summary never scan the guarded tables, for every chip, narrowing, sort and a text filter', () =>
    Effect.gen(function* () {
      const cutoff = '1700000000.000000'
      const narrowings = [{ kind: 'all' }, { kind: 'channels' }, { kind: 'dms', scope: 'D0MAYA' }, { kind: 'all', query: 'postgres plan' }] as const
      for (const narrowing of narrowings) {
        for (const status of ['all', 'quiet'] as const) {
          for (const sort of ['recent', 'oldest', 'messages'] as const) {
            const statement = orderStatement({ ...narrowing, status, sort }, cutoff, 200, 200)
            const lines = yield* plan(statement.sql, statement.params)
            assert.deepStrictEqual(scans(lines), [], `${JSON.stringify({ ...narrowing, status, sort })}\n${lines.join('\n')}`)
            assert.isTrue(lines.some((line) => /SEARCH i USING (COVERING )?INDEX topic_index_channel/.test(line)), `each conversation reads its topics through the channel index\n${lines.join('\n')}`)
          }
        }
        const counts = allTopicsCountsStatement(narrowing, cutoff)
        const countLines = yield* plan(counts.sql, counts.params)
        assert.deepStrictEqual(scans(countLines), [], countLines.join('\n'))
        const places = placesStatement(narrowing.kind)
        const placeLines = yield* plan(places.sql, places.params)
        assert.deepStrictEqual(scans(placeLines), [], placeLines.join('\n'))
      }
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('messages.list reads the Main and thread windows through their indexes', () =>
    Effect.gen(function* () {
      const targets: ReadonlyArray<WindowTarget> = [
        { kind: 'main', channel: 'C0ENG' },
        { kind: 'thread', channel: 'C0ENG', threadTs: '1700000000.000100' },
      ]
      for (const target of targets) {
        for (const anchor of [undefined, '1700000000.000200']) {
          for (const statement of windowStatements(target, { anchor, before: 50, limit: 300 })) {
            const lines = yield* plan(statement.sql, statement.params)
            assert.deepStrictEqual(scans(lines), [], `${target.kind} ${anchor ?? 'bottom'}\n${lines.join('\n')}`)
            const index = target.kind === 'main' ? 'messages_main' : 'messages_thread'
            assert.isTrue(lines.some((line) => line.includes(index)), `${target.kind} uses ${index}\n${lines.join('\n')}`)
          }
        }
      }
      for (const statement of [rootStatement({ kind: 'thread', channel: 'C0ENG', threadTs: '1700000000.000100' }), reactionsStatement('C0ENG', ['1700000000.000100', '1700000000.000200']), threadTitlesStatement(['t:C0ENG:1700000000.000100'])]) {
        const lines = yield* plan(statement.sql, statement.params)
        assert.deepStrictEqual(scans(lines), [], lines.join('\n'))
      }
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect("channel.threads reads a channel's threads through the channel index", () =>
    Effect.gen(function* () {
      const recent = threadsStatements('C0ENG', '1700000000.000000', 100)
      const all = threadsStatements('C0ENG', undefined, 100)
      for (const statement of [recent.list, recent.count, all.list, all.count]) {
        const lines = yield* plan(statement.sql, statement.params)
        assert.deepStrictEqual(scans(lines), [], lines.join('\n'))
        assert.isTrue(lines.some((line) => line.includes('topic_index_channel_activity')), lines.join('\n'))
      }
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('the New chat pickers read topic_index through an index', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(scans(yield* plan(frequentConversationsStatement, [])), [])
      const sends = frequentSendsStatement('U0SELF', 1_800_000_000_000)
      assert.deepStrictEqual(scans(yield* plan(sends.sql, sends.params)), [])
      const activity = activityStatement(['C0ENG', 'D0MAYA'])
      assert.deepStrictEqual(scans(yield* plan(activity.sql, activity.params)), [])
      for (const channel of [undefined, 'C0ENG']) {
        for (const match of [undefined, 'cutover*']) {
          const { recent, threads } = pickerStatements('1700000000.000000', channel, match)
          for (const statement of [recent, threads]) {
            const lines = yield* plan(statement.sql, statement.params)
            assert.deepStrictEqual(scans(lines), [], `${channel ?? 'everywhere'} ${match ?? ''}\n${lines.join('\n')}`)
          }
        }
      }
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('the @ and # suggestions read messages and topic_index through their indexes', () =>
    Effect.gen(function* () {
      const statements = [
        mentionStatements.threadPosters('C0ENG', '1700000000.000100'),
        mentionStatements.channelPosters('C0ENG'),
        mentionStatements.recentContacts('1700000000.000000'),
        mentionStatements.yourChannels('1700000000.000000'),
      ]
      for (const statement of statements) {
        const lines = yield* plan(statement.sql, statement.params)
        assert.deepStrictEqual(scans(lines), [], lines.join('\n'))
      }
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('Home reads topic_index and messages through their indexes', () =>
    Effect.gen(function* () {
      const statements = [
        homeStatements.unread('1700000000.000000'),
        homeStatements.topics(['t:C0ENG:1700000000.000100', 'm:D0MAYA']),
        homeStatements.threadAfter('C0ENG', '1700000000.000100', '1700000000.000000'),
        homeStatements.mainAfter('D0MAYA', '1700000000.000000'),
        staleStatement('settledScore', '1700000000.000000', '1800000000.000000', 12),
        homeStatements.automated(),
        homeStatements.askedWhy('C0ALERTS'),
        automatedStatements.candidates(),
        automatedStatements.sample('C0ALERTS'),
      ]
      for (const statement of statements) {
        const lines = yield* plan(statement.sql, statement.params)
        assert.deepStrictEqual(scans(lines), [], `${statement.sql}\n${lines.join('\n')}`)
      }
    }).pipe(Effect.provide(freshStore)),
  )

  it.effect('⌘K search reads every table through FTS or an index', () =>
    Effect.gen(function* () {
      const reader = yield* StoreReader
      for (const [name, statement] of Object.entries(searchStatements(reader, '"roll"*', 50))) {
        const [sql, params] = statement.compile()
        const lines = yield* plan(sql, params)
        assert.deepStrictEqual(scans(lines), [], `${name}\n${lines.join('\n')}`)
      }
    }).pipe(Effect.provide(freshStore)),
  )
})
