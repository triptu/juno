// The quiet window (specs/quietwindow.qnt): a 3-day first sync reads no older history, raising the window
// backfills page by page, lowering it hides older topics without reads or deletion, and a held backfill page is
// cancelled without claiming coverage. It cold-boots: the window applies to the first sync.
import { afterEach, expect, it } from 'bun:test'
import { prefsSet, searchQuery, type SearchResult } from '@juno/contract'
import { liveQuery, runCommand, sidebarListAtom } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { bootedEngine, DAY, quiet, seedThread, valueOf } from '../scenario'
import { step } from '../step'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

function liveUntil<A>(engine: RunningEngine, atom: Parameters<RunningEngine['registry']['mount']>[0], predicate: (value: A) => boolean, label: string): Promise<A> {
  unmounts.push(engine.registry.mount(atom))
  return waitFor(() => {
    const result = engine.registry.get(atom) as { _tag: string; value?: A }
    return result._tag === 'Success' && predicate(result.value as A) ? { value: result.value as A } : undefined
  }, WAIT_MS, label).then((found) => found.value)
}

const search = (engine: RunningEngine, query: string, predicate: (results: ReadonlyArray<SearchResult>) => boolean) =>
  liveUntil<ReadonlyArray<SearchResult>>(engine, liveQuery(searchQuery)({ query, limit: 50 }), predicate, `search "${query}"`)

/** `conversations.history` pages since the `since`-th call, of one channel or of any. */
const historyPages = (engine: RunningEngine, since = 0, channel?: string) =>
  engine.fake.calls.slice(since).filter((call) => call.kind === 'api' && call.method === 'conversations.history' && (channel === undefined || call.args['channel'] === channel))
/** History or search reads: none of them may come from lowering the window. Other background reads may land at any time. */
const historyReads = (engine: RunningEngine, since: number) => engine.fake.calls.slice(since).filter((call) => call.kind === 'api' && /^(conversations\.(history|replies)|search\.)/.test(call.method))

it('the quiet window: a 3-day sync reads no older history, raising backfills page by page, lowering hides without reads or deletion, and a held backfill is cancelled without claiming coverage', async () => {
  let oldThread = ''
  let oldUnread = ''
  const engine = await bootedEngine(engines, { quietDays: 3, initial: (fake) => {
    fake.addChannel({ id: 'C0FIVEDAYS', name: 'five-days', messages: [{ user: 'U0LEO', text: 'Five-day notes', ago: 5 * 24 * 60 }] })
    oldThread = seedThread(fake, { channel: 'C0PLATFORM', text: 'Five day topic', ago: 6 * DAY, replies: [5 * DAY], follow: true }).id
    oldUnread = seedThread(fake, { channel: 'C0PLATFORM', text: 'Older unread topic', ago: 7 * DAY, replies: [6 * DAY], follow: true, unread: 1 }).id
    fake.addChannel({ id: 'C0OLDPAGES', name: 'old-pages', messages: Array.from({ length: 220 }, (_, i) => ({ user: 'U0LEO', text: `Old note ${i}`, ago: 10 * 24 * 60 - i })) })
    return fake.signIn()
  } })
  const { registry } = engine
  const setDays = async (days: number) => valueOf(await runCommand(registry, prefsSet, { key: 'quietDays', value: days }))
  unmounts.push(registry.mount(sidebarListAtom))

  await step('a 3-day first sync reads no history for conversations quiet longer, and shows an older unread thread', async () => {
    expect(historyPages(engine, 0, 'C0FIVEDAYS')).toEqual([])
    expect(historyPages(engine, 0, 'C0OLDPAGES')).toEqual([])
    const rows = await engine.rowsUntil((all) => all.some((r) => r.id === oldUnread), 'the older unread thread')
    expect(rows.some((r) => r.id === oldThread || r.channel.id === 'C0FIVEDAYS')).toBe(false)
  })

  await step('raising to 7 days backfills on the background lane, and the five-day conversation and thread show', async () => {
    const since = engine.fake.calls.length
    await setDays(7)
    await engine.rowsUntil((all) => all.some((r) => r.id === oldThread) && all.some((r) => r.channel.id === 'C0FIVEDAYS'), 'the five-day topics')
    await quiet(engine)
    expect(historyPages(engine, since, 'C0FIVEDAYS').length).toBeGreaterThan(0)
    expect(historyPages(engine, since).every((call) => call.args['_x_reason'] === 'window-history')).toBe(true)
    expect(historyPages(engine, since, 'C0OLDPAGES')).toEqual([])
  })

  await step('lowering to 3 days hides the read five-day thread with no history read; raising back shows it from the cache with no history page', async () => {
    const since = engine.fake.calls.length
    await setDays(3)
    await engine.rowsUntil((all) => !all.some((r) => r.id === oldThread) && all.some((r) => r.id === oldUnread), 'the five-day thread hidden')
    await quiet(engine)
    expect(historyReads(engine, since)).toEqual([])
    const painted = await waitFor(() => {
      const window = registry.get(sidebarListAtom)
      return !window.rows.has(oldThread) && window.rows.has(oldUnread) ? window.order : undefined
    }, WAIT_MS, 'painted rows at three days')
    await setDays(7)
    await waitFor(() => registry.get(sidebarListAtom).rows.has(oldThread) || undefined, WAIT_MS, 'the cached thread back')
    expect<unknown>(registry.get(sidebarListAtom).order.slice(0, painted.length)).toEqual(painted)
    await quiet(engine)
    // Raising looks for new threads again, but the history it holds is not read again.
    expect(historyPages(engine, since)).toEqual([])
  })

  await step('lowering while a backfill page is held cancels it without claiming its coverage: raising again asks for the same page', async () => {
    const since = engine.fake.calls.length
    engine.fake.holdNext({ method: 'conversations.history', reason: 'window-history' })
    await setDays(14)
    const held = await waitFor(() => engine.fake.heldCalls({ method: 'conversations.history' })[0] as Record<string, string> | undefined, WAIT_MS, 'the held backfill page')
    await setDays(1)
    await engine.syncIdle()
    engine.fake.release()
    await quiet(engine)
    // Lowering asked for nothing more.
    expect(historyPages(engine, since).filter((call) => call.args['_x_reason'] === 'window-history')).toHaveLength(1)

    const resumed = engine.fake.calls.length
    await setDays(14)
    const again = await waitFor(() => historyPages(engine, resumed, held['channel'])[0], WAIT_MS, 'the held page asked again')
    // The same page again: the held one stored nothing and covered nothing.
    expect(again.args['latest']).toBe(held['latest'])
  })

  await step('a 14-day backfill pages a long conversation to the window and stores every message, and is not read again', async () => {
    // Every page of #old-pages, the oldest message included.
    await search(engine, 'Old note 0', (results) => results.some((result) => result.kind === 'message' && result.text === 'Old note 0'))
    await quiet(engine)
    expect(historyPages(engine, 0, 'C0OLDPAGES').length).toBeGreaterThanOrEqual(3)
    const since = engine.fake.calls.length
    await setDays(3)
    await quiet(engine)
    await setDays(14)
    await engine.rowsUntil((all) => all.some((r) => r.channel.id === 'C0OLDPAGES'), 'old pages in the window')
    await quiet(engine)
    expect(historyPages(engine, since)).toEqual([])
  })
})
