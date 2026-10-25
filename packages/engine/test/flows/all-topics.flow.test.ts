// The All topics page (SPEC 11, inventory 10) against the fake Slack, through the atoms the page reads:
// the status chips, kind, sort and text narrow the list of the synced default workspace, the chips count
// under the filters, and a row's status follows what the user does to its topic. The rule itself, over
// every chip, narrowing and sort, is `all-topics-rule.test.ts`; the place picker is in the browser test.
import { afterEach, expect, it } from 'bun:test'
import { allTopicsSummary, topicsResolve, type AllTopicsFilter, type AllTopicsSummary, type TopicRow } from '@juno/contract'
import { allTopicsFilterAtom, allTopicsLayoutAtom, allTopicsRowAtom, defaultAllTopicsFilter, liveQuery, runCommand, type Registry } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { subscribe, threadId, unsubscribe, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

// Titles are the first six words of the root message, so a prefix is enough.
const QUIET = 'Lag alerts are firing on the'
const POSTGRES = 'Draft plan is in the doc'
const STAGING = 'Unrelated: has anyone looked at the'
// A thread in the DM with Maya.
const OFFSITE = 'Can eng take the Wednesday afternoon'

/** The rows the page shows, in order. */
interface Shown {
  readonly order: ReadonlyArray<string>
  readonly rows: ReadonlyArray<TopicRow>
}
const titles = (shown: Shown) => shown.rows.map((row) => row.title)
const has = (shown: Shown, prefix: string) => titles(shown).some((title) => title.startsWith(prefix))
const rowOf = (shown: Shown, prefix: string): TopicRow | undefined => shown.rows.find((row) => row.title.startsWith(prefix))
const shownIn = (registry: Registry): Shown => {
  const { order } = registry.get(allTopicsLayoutAtom)
  return { order, rows: order.map((id) => registry.get(allTopicsRowAtom(id))!) }
}

it('narrows All topics by status, kind, sort and text, counts each chip, and shows a row’s status as it changes', async () => {
  const engine = await syncedEngine(engines)
  const { registry } = engine
  unmounts.push(registry.mount(allTopicsLayoutAtom))

  /** The page's list once its window belongs to `patch` on the default filter and `ready` holds for it. */
  const show = (patch: Partial<AllTopicsFilter>, ready: (shown: Shown) => boolean = () => true, label = JSON.stringify(patch)) => {
    const filter = { ...defaultAllTopicsFilter, ...patch }
    registry.set(allTopicsFilterAtom, filter)
    return waitFor(() => {
      const layout = registry.get(allTopicsLayoutAtom)
      if (layout.filter !== filter || !layout.ready) return undefined
      const shown = shownIn(registry)
      return ready(shown) ? shown : undefined
    }, WAIT_MS, label)
  }
  const summary = (payload: Pick<AllTopicsFilter, 'kind' | 'query'>, ready: (value: AllTopicsSummary) => boolean, label: string) => {
    const atom = liveQuery(allTopicsSummary)(payload)
    unmounts.push(registry.mount(atom))
    return waitFor(() => {
      const result = registry.get(atom)
      return result._tag === 'Success' && ready(result.value) ? result.value : undefined
    }, WAIT_MS, label)
  }

  await step('each status chip lists its topics, and Resolved starts empty', async () => {
    const quiet = await show({ status: 'quiet' })
    expect(has(quiet, QUIET)).toBe(true)
    expect(has(quiet, POSTGRES)).toBe(false)
    expect(titles(quiet).every((title) => title !== '')).toBe(true)
    const open = await show({ status: 'open' })
    expect(has(open, POSTGRES)).toBe(true)
    expect(has(open, QUIET)).toBe(false)
    expect((await show({ status: 'resolved' })).order).toEqual([])
    const counts = (await summary({ kind: 'all' }, () => true, 'the chip counts')).counts
    expect(counts.resolved).toBe(0)
    expect(counts.quiet).toBeGreaterThan(0)
    expect(counts.all).toBe(counts.open + counts.resolved + counts.quiet + counts.unsubscribed)
  })

  await step('DMs and Channels each keep only their own topics', async () => {
    const dms = await show({ kind: 'dms' })
    expect([has(dms, OFFSITE), has(dms, POSTGRES)]).toEqual([true, false])
    const channels = await show({ kind: 'channels' })
    expect([has(channels, OFFSITE), has(channels, POSTGRES)]).toEqual([false, true])
  })

  await step('Most messages puts the six-reply Postgres thread above the two-reply quiet one, and Oldest first the other way', async () => {
    const index = (shown: Shown, prefix: string) => titles(shown).findIndex((title) => title.startsWith(prefix))
    const byMessages = await show({ sort: 'messages' })
    expect(index(byMessages, POSTGRES)).toBeLessThan(index(byMessages, QUIET))
    const oldest = await show({ sort: 'oldest' })
    expect(index(oldest, QUIET)).toBeLessThan(index(oldest, POSTGRES))
  })

  await step('a word from a reply finds its thread, and words nothing says find nothing', async () => {
    const reaper = await show({ query: 'reaper' })
    expect(titles(reaper)).toHaveLength(1)
    expect(has(reaper, STAGING)).toBe(true)
    expect((await summary({ kind: 'all', query: 'reaper' }, () => true, 'the counts for "reaper"')).counts.all).toBe(1)
    expect((await show({ query: 'nothing in slack says this' })).order).toEqual([])
    const cleared = await show({})
    expect([has(cleared, POSTGRES), has(cleared, QUIET)]).toEqual([true, true])
  })

  await step('a row shows Resolved, then Unfollowed after Never, and a never-followed thread followed from here gets a sidebar row', async () => {
    const postgres = threadId(engine.fake, 'C0ENG', POSTGRES)
    valueOf(await runCommand(registry, topicsResolve, { id: postgres }))
    await show({}, (shown) => rowOf(shown, POSTGRES)?.status === 'resolved', 'Postgres resolved')
    await summary({ kind: 'all' }, (value) => value.counts.resolved === 1, 'one resolved')

    valueOf(await unsubscribe(engine, postgres))
    await show({}, (shown) => rowOf(shown, POSTGRES)?.status === 'unsubscribed', 'Postgres unfollowed')
    await engine.rowsUntil((rows) => !rows.some((row) => row.id === postgres), 'Postgres gone from the sidebar')

    const flags = threadId(engine.fake, 'C0PLATFORM', 'We have 142 flags')
    const before = await show({})
    expect(before.order).toContain(flags)
    expect((await engine.rows()).some((row) => row.id === flags)).toBe(false)
    valueOf(await subscribe(engine, flags))
    await engine.rowsUntil((rows) => rows.some((row) => row.id === flags), 'the flags thread in the sidebar')
  })
})
