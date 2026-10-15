// The sidebar rule of spec section 5 ("What shows up") exists twice: as SQL
// in the sidebar and counts queries (`topics/query.ts`) and as the pure rule
// in `@juno/domain` (`sidebarPlacement`). These tests hold the two together:
// first over a table of every status a topic can have, straight against a
// store, then end to end for the two mention branches.
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { byLatestActivity, isDm, matchesSidebarFilter, sidebarPlacement, type ChannelId, type SidebarFilter, type Topic } from '@juno/domain'
import type { TopicCounts } from '@juno/contract'
import { SELF_ID } from '@juno/fake-slack'
import { topicCountsAtom } from '@juno/state'
import { countTopics, listTopics, type ListFilter } from '../src/topics/query'
import { startTestEngine, type RunningEngine } from './harness'
import { NOW, seed, shownConversation, statusTable, tempStore, topicOf, tsOf } from './statusTable'

const FILTERS: ReadonlyArray<ListFilter> = [
  { kind: 'all', unreadOnly: false },
  { kind: 'channels', unreadOnly: false },
  { kind: 'dms', unreadOnly: false },
  { kind: 'all', unreadOnly: true },
  { kind: 'dms', unreadOnly: true },
  { kind: 'all', unreadOnly: false, scope: 'C0THREADS' },
  { kind: 'all', unreadOnly: false, scope: 'C0ALIVE' },
]

describe('the sidebar rule, query against domain', () => {
  it('listTopics and the counts agree with sidebarPlacement over the status table, for every filter', async () => {
    const { conversations, cases } = statusTable()
    // The domain's answer. Membership and archiving are the store's business, not the rule's: those topics never show.
    const channelActivity = new Map<string, string>()
    for (const c of cases) {
      const ts = tsOf(c)
      const known = channelActivity.get(c.channel.id)
      if (known === undefined || ts > known) channelActivity.set(c.channel.id, ts)
    }
    const topics = cases.filter((c) => shownConversation(c.channel)).map((c) => topicOf(c, channelActivity.get(c.channel.id)))
    const expected = (filter: ListFilter) => {
      const domainFilter: SidebarFilter = { kind: filter.kind, unreadOnly: filter.unreadOnly, ...(filter.scope === undefined ? {} : { scope: filter.scope as ChannelId }) }
      const pinned: Array<Topic> = []
      const recent: Array<Topic> = []
      for (const topic of topics) {
        if (!matchesSidebarFilter(topic, domainFilter)) continue
        const placement = sidebarPlacement(topic, { now: NOW })
        if (placement === 'pinned') pinned.push(topic)
        if (placement === 'recent') recent.push(topic)
      }
      return { pinned: pinned.toSorted(byLatestActivity).map((t) => t.id), recent: recent.toSorted(byLatestActivity).map((t) => t.id) }
    }
    const expectedCounts = (scope: string | undefined): TopicCounts => {
      const shown = topics.filter(
        (t) => (scope === undefined || t.channel.id === scope) && t.activity.unreadCount > 0 && sidebarPlacement(t, { now: NOW }) !== 'hidden',
      )
      return { channelsUnread: shown.filter((t) => !isDm(t.channel.kind)).length, dmsUnread: shown.filter((t) => isDm(t.channel.kind)).length }
    }

    const program = Effect.gen(function* () {
      yield* seed(conversations, cases)
      for (const filter of FILTERS) {
        const { rows } = yield* listTopics(filter, { now: NOW, limit: 300 })
        const want = expected(filter)
        const label = JSON.stringify(filter)
        expect(rows.filter((r) => r.section === 'pinned').map((r) => r.id), `pinned, ${label}`).toEqual(want.pinned)
        expect(rows.filter((r) => r.section === 'recent').map((r) => r.id), `recent, ${label}`).toEqual(want.recent)
      }
      for (const scope of [undefined, 'C0THREADS', 'C0PUBLICNONE21']) {
        expect(yield* countTopics(scope), `counts, scope ${scope}`).toEqual(expectedCounts(scope))
      }
    })
    await Effect.runPromise(program.pipe(Effect.provide(tempStore), Effect.scoped))

    // The table covers the branches it is for.
    const all = expected({ kind: 'all', unreadOnly: false })
    const mentionOnly = cases.filter((c) => c.kind === 'thread' && c.subscribed === null && c.mention && c.unread > 0 && c.overlay === 'none')
    expect(mentionOnly.length).toBeGreaterThan(0)
    for (const c of mentionOnly) expect(all.recent).toContain(c.id)
    const unfollowedMention = cases.filter((c) => c.kind === 'thread' && c.subscribed === 0 && c.mention && c.unread > 0 && c.overlay === 'none')
    for (const c of unfollowedMention) expect([...all.pinned, ...all.recent]).not.toContain(c.id)
    expect(all.recent).toContain(`m:C0ALIVE`)
  })
})

// End to end: the engine on the fake, the two mention branches arriving over the socket.

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop()
})

async function liveEngine(): Promise<RunningEngine> {
  const engine = await startTestEngine({ initial: (fake) => fake.signIn() })
  engines.push(engine)
  await engine.status('ready')
  await engine.phase('live')
  return engine
}

/** The counts the engine sends, once they equal what the sidebar shows: unread channel and DM rows. */
async function countsMatchRows(engine: RunningEngine): Promise<TopicCounts> {
  const atom = topicCountsAtom()
  const unmount = engine.registry.mount(atom)
  try {
    let counts: TopicCounts | undefined
    await engine.rowsUntil((rows) => {
      const result = engine.registry.get(atom)
      if (result._tag !== 'Success') return false
      const channels = rows.filter((r) => r.unreadCount > 0 && !isDm(r.channel.kind)).length
      const dms = rows.filter((r) => r.unreadCount > 0 && isDm(r.channel.kind)).length
      counts = result.value
      return counts.channelsUnread === channels && counts.dmsUnread === dms
    }, 'the counts to match the rows')
    return counts!
  } finally {
    unmount()
  }
}

describe('the mention branches, end to end', () => {
  it('a mention in a thread Slack said nothing about brings the thread in, and the counts go up', async () => {
    const engine = await liveEngine()
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const before = await countsMatchRows(engine)

    const root = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Who owns the flaky checkout test?' })
    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: `<@${SELF_ID}> can you take a look?`, threadTs: root.ts })
    const id = `t:C0ENG:${root.ts}`

    const rows = await engine.rowsUntil((list) => list.some((r) => r.id === id), 'the mentioned thread')
    expect(rows.find((r) => r.id === id)).toMatchObject({ kind: 'thread', mentionsMe: true, subscribed: false, section: 'recent' })
    expect(rows.find((r) => r.id === id)!.unreadCount).toBeGreaterThan(0)
    const after = await countsMatchRows(engine)
    expect(after.channelsUnread).toBeGreaterThan(before.channelsUnread)
  })

  it('a mention after an explicit unfollow keeps the thread hidden and out of the counts', async () => {
    const engine = await liveEngine()
    const rows = await engine.rowsUntil((list) => list.length >= 20, 'rows')
    const root = engine.fake.messages('C0ENG').find((m) => m.text?.startsWith('Draft plan is in the doc.'))!
    const id = `t:C0ENG:${root.ts}`
    expect(rows.find((r) => r.id === id)).toMatchObject({ subscribed: true })

    engine.fake.workspace.unsubscribe('C0ENG', root.ts as Parameters<typeof engine.fake.workspace.unsubscribe>[1])
    await engine.rowsUntil((list) => !list.some((r) => r.id === id), 'the unfollowed thread gone')
    const before = await countsMatchRows(engine)

    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: `<@${SELF_ID}> one more thing on the plan.`, threadTs: root.ts })
    // Events apply in order: once a later message has reached its row, the mention has been applied too.
    engine.fake.injectMessage({ channel: 'D0SAM', user: 'U0SAM', text: 'Unrelated, later.' })
    const after = await engine.rowsUntil((list) => list.some((r) => r.preview.text === 'Unrelated, later.'), 'the later message')
    expect(after.some((r) => r.id === id)).toBe(false)
    const counts = await countsMatchRows(engine)
    expect(counts.channelsUnread).toBe(before.channelsUnread)
  })
})
