// The All topics rule (spec section 11) exists twice: as SQL in the order
// and counts statements (`topics/allTopics.ts`) and as the pure rule in
// `@juno/domain` (`allTopicsList`). This test holds the two together over
// the status table, for every chip, kind, place and sort, reading the list
// in windows the way the page does.
import { Effect } from 'effect'
import { describe, expect, it } from 'bun:test'
import { allTopicsList, type AllTopicsFilter as DomainFilter, type ChannelId } from '@juno/domain'
import type { AllTopicsFilter, TopicListRow } from '@juno/contract'
import { listAllTopics, summarizeAllTopics } from '../src/topics/allTopics'
import { makeRowCache } from '../src/topics/query'
import { NOW, seed, statusTable, tempStore, topicOf, tsOf } from './statusTable'

const NARROWINGS: ReadonlyArray<Pick<AllTopicsFilter, 'kind' | 'scope'>> = [
  { kind: 'all' },
  { kind: 'channels' },
  { kind: 'dms' },
  { kind: 'all', scope: 'C0THREADS' },
  { kind: 'all', scope: 'C0ARCHIVED' },
]
const CHIPS: ReadonlyArray<AllTopicsFilter['status']> = ['all', 'open', 'resolved', 'quiet', 'unsubscribed']
const SORTS: ReadonlyArray<AllTopicsFilter['sort']> = ['recent', 'oldest', 'messages']

/** Windows smaller than the table, so reading a list takes several. */
const WINDOW = 70

describe('the All topics rule, query against domain', () => {
  it('lists, pages and counts every topic as allTopicsList does, for every chip, narrowing and sort', async () => {
    const { conversations, cases } = statusTable()
    const channelActivity = new Map<string, string>()
    for (const c of cases) {
      const ts = tsOf(c)
      const known = channelActivity.get(c.channel.id)
      if (known === undefined || ts > known) channelActivity.set(c.channel.id, ts)
    }
    // Every topic of a conversation the user is in, archived ones too. Ignored channels are the rule's to drop.
    const topics = cases.filter((c) => c.channel.member !== false).map((c) => topicOf(c, channelActivity.get(c.channel.id)))

    const program = Effect.gen(function* () {
      yield* seed(conversations, cases)
      for (const narrowing of NARROWINGS) {
        for (const status of CHIPS) {
          for (const sort of SORTS) {
            const filter: AllTopicsFilter = { ...narrowing, status, sort }
            const domainFilter: DomainFilter = { status, sort, kind: narrowing.kind, ...(narrowing.scope === undefined ? {} : { scope: narrowing.scope as ChannelId }) }
            const want = allTopicsList(topics, domainFilter, { now: NOW })
            const rows: Array<TopicListRow> = []
            let total = 0
            do {
              const run = yield* listAllTopics(filter, { now: NOW, offset: rows.length, limit: WINDOW }, makeRowCache())
              total = run.total ?? 0
              rows.push(...run.rows)
              if (run.rows.length === 0) break
            } while (rows.length < total)
            const label = JSON.stringify(filter)
            expect(rows.map((row) => [row.id, row.status]), label).toEqual(want.rows.map((row) => [row.topic.id, row.status]))
            expect(total, label).toBe(want.rows.length)
            expect(rows.every((row) => (row.section === 'pinned') === row.pinned), label).toBe(true)
          }
        }
        const summary = yield* summarizeAllTopics(narrowing, NOW)
        expect(summary.counts, JSON.stringify(narrowing)).toEqual(allTopicsList(topics, { ...narrowing, scope: narrowing.scope as ChannelId | undefined, status: 'all', sort: 'recent' } as DomainFilter, { now: NOW }).counts)
      }
      const places = yield* summarizeAllTopics({ kind: 'all' }, NOW)
      // Ignored and non-member conversations are not places; channels come before DMs.
      const ids = places.places.map((place) => place.id)
      expect(ids).not.toContain('C0IGNORED')
      expect(ids).not.toContain('C0MEMBER')
      expect(ids).toContain('C0ARCHIVED')
      const firstDm = places.places.findIndex((place) => place.kind === 'im' || place.kind === 'mpim')
      expect(places.places.slice(firstDm).every((place) => place.kind === 'im' || place.kind === 'mpim')).toBe(true)
    })
    await Effect.runPromise(program.pipe(Effect.provide(tempStore), Effect.scoped))

    // The table reaches every chip.
    const counts = allTopicsList(topics, { status: 'all', kind: 'all', sort: 'recent' }, { now: NOW }).counts
    for (const chip of ['open', 'resolved', 'quiet', 'unsubscribed'] as const) expect(counts[chip], chip).toBeGreaterThan(0)
  })
})
