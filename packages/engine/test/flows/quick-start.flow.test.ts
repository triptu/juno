// What comes right after the quick start (architecture 5.8, "Sync", step 4): the preview search (`searchPreviews`
// in `@juno/sync` discovery) gives the busiest channels a preview before their history is read, and Home is ready
// once what it is made of has history, before the rest. Cold boots on a fresh fake, since the first sync is what
// they test.
import { afterEach, expect, it } from 'bun:test'
import type { TopicRow } from '@juno/contract'
import { largeSeed, SELF_ID } from '@juno/fake-slack'
import { homeViewAtom } from '@juno/state'
import { startTestEngine, waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { apiCalls, DAY } from '../scenario'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

it('the busiest channels preview their newest message from the preview search while their history waits', async () => {
  // Every history page waits, so a channel's newest message can only come from the search.
  const engine = await startTestEngine({ initial: (fake) => {
    fake.holdNext({ method: 'conversations.history', times: 1_000, before: true, reason: 'history' })
    return fake.signIn()
  } })
  engines.push(engine)
  await engine.status('ready')
  // Before it, a channel's Main shows the root of a followed thread from getView at most; the search brings its newest message.
  const preview = (rows: ReadonlyArray<TopicRow>, id: string) => rows.find((row) => row.id === id)?.preview
  const rows = await engine.rowsUntil((list) => preview(list, 'm:C0ENG')?.sender === 'Dev' && preview(list, 'm:C0PLATFORM')?.sender === 'Jonas', 'the newest messages as previews')
  expect([preview(rows, 'm:C0ENG'), preview(rows, 'm:C0PLATFORM')]).toEqual([
    { sender: 'Dev', text: '@Leo I think the preview environments never shut down. Will check.' },
    { sender: 'Jonas', text: "We have 142 flags. 61 haven't changed in 90 days." },
  ])
  expect(apiCalls(engine, 'conversations.history')).toHaveLength(0)
  expect(engine.fake.heldCount({ method: 'conversations.history' })).toBe(1)
  engine.fake.release({ method: 'conversations.history' })
  await engine.phase('live')
})

it('Home is ready once DMs, mentions and unread followed threads have history, before the rest of history', async () => {
  // What Home is made of (SPEC 12, owner 10-18): DMs and group DMs, conversations with an unread mention, and those
  // with unread replies in a followed thread, inside the three-day topic window.
  const seed = largeSeed({ topics: 300, messages: 3_000, users: 100, channels: { public: 20, private: 6, dms: 8, mpims: 3 } })
  let forHome = new Set<string>()
  const engine = await startTestEngine({
    fakeOptions: { seed },
    initial: (fake) => {
      const ws = fake.workspace
      const threads = ws.threadCounts()
      const windowStart = (Date.now() - 3 * DAY) / 1000
      forHome = new Set([...ws.conversations.values()].filter((c) => {
        if (!c.members.has(SELF_ID) || c.archived) return false
        const entry = ws.countEntry(c)
        if (entry.latest === undefined || Number(entry.latest) < windowStart) return false
        return c.kind === 'im' || c.kind === 'mpim' || (entry.has_unreads && entry.mention_count > 0)
          || (threads.mention_count_by_channel?.[c.id] ?? 0) > 0 || (threads.unread_count_by_channel?.[c.id] ?? 0) > 0
      }).map((c) => c.id))
      // The history of anything else waits, so the sync stops at the first conversation Home does not need.
      fake.gate((method, args) => method === 'conversations.history' && args['_x_reason'] === 'history' && !forHome.has(args['channel'] ?? ''))
      return fake.signIn()
    },
  })
  engines.push(engine)
  await engine.status('ready')
  const unmount = engine.registry.mount(homeViewAtom)
  try {
    const home = () => {
      const result = engine.registry.get(homeViewAtom)
      return result._tag === 'Success' ? result.value : undefined
    }
    expect(forHome.size).toBeGreaterThan(3)
    await waitFor(() => (home()?.ready === true ? true : undefined), 30_000, 'Home ready')
    expect(home()?.firstSync).toBe(true)
    expect(engine.fake.gated().filter((call) => call.method === 'conversations.history')).toHaveLength(1)
    const read = new Set(apiCalls(engine, 'conversations.history').filter((call) => call.args['_x_reason'] === 'history').map((call) => call.args['channel']))
    expect([...forHome].filter((id) => !read.has(id))).toEqual([])
    expect((await engine.phase('catching-up'))._tag).toBe('catching-up')
    engine.fake.gate()
    await engine.phase('live', 30_000)
    await waitFor(() => (home()?.firstSync === false && home()?.ready === true ? true : undefined), WAIT_MS, 'Home after the boot')
  } finally {
    unmount()
  }
})
