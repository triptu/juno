import { afterEach, expect, it } from 'bun:test'
import { parseSearchQuery, printSearchQuery, searchMore, searchQuery, viewsSortChannel, topicsRename, type SearchSnapshot, type SearchQuery } from '@juno/contract'
import { liveQuery, runCommand, searchSnapshots } from '@juno/state'
import { syncedEngine } from '../synced'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { valueOf } from '../scenario'
import { step } from '../step'

const engines: RunningEngine[] = []
const releases: Array<() => void> = []
afterEach(async () => {
  for (const release of releases.splice(0)) release()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})
const session = (engine: RunningEngine, query: SearchQuery, sessionId: string, generation = 1) => {
  const atom = searchSnapshots({ sessionId, generation, query, immediate: true })
  releases.push(engine.registry.mount(atom))
  const read = () => {
    const result = engine.registry.get(atom)
    return result._tag === 'Success' ? result.value : undefined
  }
  return { read, until: (predicate: (s: SearchSnapshot) => boolean) => waitFor(() => { const value = read(); return value !== undefined && predicate(value) ? value : undefined }, WAIT_MS, `session ${sessionId}`) }
}
const ids = (s: SearchSnapshot) => s.groups.flatMap((g) => g.messages.map((m) => m.id))
const localReady = async (engine: RunningEngine, query: string, count: number) => {
  const atom = liveQuery(searchQuery)({ query, limit: 50 })
  const release = engine.registry.mount(atom)
  try { return await waitFor(() => { const result = engine.registry.get(atom); return result._tag === 'Success' && result.value.filter((r) => r.kind === 'message').length === count ? result.value : undefined }, WAIT_MS, 'local search ready') }
  finally { release() }
}

it('paints local rows before Slack, pages a stable merged list and rejects old generations', async () => {
  const engine = await syncedEngine(engines)
  const { fake } = engine
  const now = fake.now()
  fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'frontiertest recent', at: now - 1000 })
  fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'frontiertest cached old', at: now - 100_000 })
  await localReady(engine, 'frontiertest', 2)
  for (let i = 0; i < 75; i++) fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: `frontiertest remote ${i}`, at: now - 2000 - i * 1000, silent: true })
  fake.holdNext({ method: 'search.modules.messages', reason: 'search' })
  const search = session(engine, parseSearchQuery('frontiertest'), 'frontier')
  const local = await search.until((s) => s.state === 'searching' && ids(s).length === 2)
  expect(local.counts.local).toBe(2)
  expect(local.frontier.complete).toBe(false)
  await waitFor(() => fake.heldCount({ method: 'search.modules.messages' }) > 0 ? true : undefined)
  fake.release({ method: 'search.modules.messages' })
  const first = await search.until((s) => s.state === 'done')
  expect(first.pagination).toMatchObject({ page: 1, hasMore: true, perPage: 50 })
  expect(first.counts.slackTotal).toBe(77)
  const established = first.groups.filter((g) => !g.older).flatMap((g) => g.messages.map((m) => m.id))
  expect(valueOf(await runCommand(engine.registry, searchMore, { sessionId: 'frontier', generation: 1 }))).toBe(true)
  const complete = await search.until((s) => s.state === 'done' && s.pagination.page === 2)
  expect(ids(complete).slice(0, established.length)).toEqual(established)
  expect(new Set(ids(complete)).size).toBe(77)
  expect(complete.frontier.complete).toBe(true)
  expect(complete.facets.from.find((f) => f.id === 'U0LEO')).toMatchObject({ count: 75, person: { id: 'U0LEO' } })
  expect(complete.groups.flatMap((g) => g.messages).every((m) => m.ranges.length > 0)).toBe(true)

  await step('a completed title row keeps its anchor when an older message arrives on a later page', async () => {
    const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'A separate title anchor', at: now - 200_000 })
    fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'New activity without the needle', threadTs: root.ts, at: now })
    await engine.socketIdle()
    valueOf(await runCommand(engine.registry, topicsRename, { id: `t:C0ENG:${root.ts}`, title: 'anchorneedle title' }))
    for (let i = 0; i < 60; i++) fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'anchorneedle elsewhere', at: now - 1000 - i * 1000, silent: true })
    fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'anchorneedle older reply', threadTs: root.ts, at: now - 100_000, silent: true })
    const titles = session(engine, parseSearchQuery('anchorneedle'), 'title-anchor')
    const before = await titles.until((s) => s.state === 'done')
    const anchor = before.groups.find((g) => g.topicId === `t:C0ENG:${root.ts}`)
    expect(anchor).toMatchObject({ kind: 'topic', older: false })
    valueOf(await runCommand(engine.registry, searchMore, { sessionId: 'title-anchor', generation: 1 }))
    const after = await titles.until((s) => s.state === 'done' && s.pagination.page === 2)
    expect(after.groups[before.groups.indexOf(anchor!)]).toBe(anchor)
    expect(after.groups.flatMap((g) => g.messages).some((m) => m.text.includes('older reply'))).toBe(true)
  })
  await step('loaded windows move without asking Slack for more pages, including a request held behind the first page', async () => {
    for (let i = 0; i < 260; i++) fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: `windowprobe ${i}`, at: now - i * 1000 })
    await engine.socketIdle()
    fake.holdNext({ method: 'search.modules.messages', reason: 'search' })
    const windows = session(engine, parseSearchQuery('windowprobe'), 'windows')
    await windows.until((s) => s.counts.local === 200)
    await waitFor(() => fake.heldCount({ method: 'search.modules.messages' }) > 0 ? true : undefined)
    expect(valueOf(await runCommand(engine.registry, searchMore, { sessionId: 'windows', generation: 1, offset: 150 }))).toBe(true)
    fake.release({ method: 'search.modules.messages' })
    await windows.until((s) => s.window.offset === 150 && s.state === 'done')
    const calls = fake.callCount('search.modules.messages')
    for (const offset of [50, 100, 0, 150, 50]) {
      valueOf(await runCommand(engine.registry, searchMore, { sessionId: 'windows', generation: 1, offset }))
      const moved = await windows.until((s) => s.window.offset === offset)
      expect(ids(moved)).toHaveLength(100)
    }
    expect(fake.callCount('search.modules.messages')).toBe(calls)
  })
  await step('closing a typed search before the pause cancels its remote work', async () => {
    const atom = searchSnapshots({ sessionId: 'closed', generation: 1, query: parseSearchQuery('frontiertest'), immediate: false })
    const close = engine.registry.mount(atom)
    await waitFor(() => engine.registry.get(atom)._tag === 'Success' ? true : undefined)
    const calls = fake.callCount('search.modules.messages')
    close()
    // There is no completion signal for cancelled work. Wait past its 400 ms start deadline.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(fake.callCount('search.modules.messages')).toBe(calls)
  })

  await step('an answer from an older generation cannot replace the new query', async () => {
    fake.holdNext({ method: 'search.modules.messages', reason: 'search' })
    const stale = session(engine, parseSearchQuery('frontiertest'), 'typing', 1)
    await stale.until((s) => s.state === 'searching')
    await waitFor(() => fake.heldCount({ method: 'search.modules.messages' }) > 0 ? true : undefined)
    const newer = session(engine, parseSearchQuery('nothingforthisquery'), 'typing', 2)
    await newer.until((s) => s.state === 'done')
    fake.release({ method: 'search.modules.messages' })
    expect(valueOf(await runCommand(engine.registry, searchMore, { sessionId: 'typing', generation: 1 }))).toBe(false)
    expect(printSearchQuery(newer.read()!.query)).toBe('nothingforthisquery')
    expect(ids(newer.read()!)).toEqual([])
  })
}, 90_000)

it('local and Slack identity/date filters agree; apps and Automated are hidden with explicit scope overriding Automated', async () => {
  const engine = await syncedEngine(engines)
  const { fake, registry } = engine
  const self = fake.workspace.users.get(fake.workspace.selfId)
  if (self !== undefined) fake.workspace.users.set(self.id, { ...self, tz: 'Asia/Kolkata' })
  const at = Date.parse('2026-10-10T18:30:00Z')
  for (const [channel, user, delta] of [['C0ENG', 'U0MAYA', -1000], ['C0ENG', 'U0MAYA', 1000], ['C0ENG', 'U0LEO', 2000], ['D0MAYA', 'U0MAYA', 3000]] as const) {
    fake.workspace.post({ channel, user, text: 'filterparity launch', at: at + delta })
  }
  await localReady(engine, 'filterparity', 4)
  for (const text of ['filterparity from:@maya in:#eng on:2026-10-11', 'filterparity from:<@U0MAYA> in:<#C0ENG> in:<#D0MAYA> after:2026-10-10 before:2026-10-12', 'filterparity -from:U0LEO -in:D0MAYA during:2026-10-10']) {
    fake.holdNext({ method: 'search.modules.messages', reason: 'search' })
    const search = session(engine, parseSearchQuery(text, { timeZone: 'Asia/Kolkata' }), text)
    const local = await search.until((s) => s.state === 'searching' && s.counts.local > 0)
    await waitFor(() => fake.heldCount({ method: 'search.modules.messages' }) > 0 ? true : undefined)
    fake.release({ method: 'search.modules.messages' })
    const done = await search.until((s) => s.state === 'done')
    expect(ids(done)).toEqual(ids(local))
    expect(done.counts.slackTotal).toBe(local.counts.local)
  }
  await step('bound query values execute safely and filters select message identities in the real store', async () => {
    const post = (channel: string, user: string, text: string, extra = {}) => fake.workspace.post({ channel, user, text, ...extra })
    const maya = post('C0ENG', 'U0MAYA', 'ruleprobe rollout plan', { attachments: [{ title_link: 'https://example.test/plan' }] })
    const dm = post('D0MAYA', 'U0MAYA', 'ruleprobe rollout plan')
    const leo = post('C0ENG', 'U0LEO', 'ruleprobe obsolete rollout plan')
    const bot = post('C0ENG', 'U0GRAFANA', 'ruleprobe rollout plan')
    const anonymous = post('C0ENG', 'U0MAYA', 'ruleprobe anonymous', { silent: true })
    const { user: _user, ...noUser } = anonymous
    const messages = fake.workspace.all('C0ENG')
    messages[messages.findIndex((m) => m.ts === anonymous.ts)] = noUser
    fake.emitFrame({ ...noUser, channel: 'C0ENG', type: 'message' })
    const hostile = post('C0ENG', 'U0MAYA', 'ruleprobe quoted "plan" colon:value (ready) 🚀 café')
    await engine.socketIdle()
    const cases: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
      ['ruleprobe in:C0ENG in:D0MAYA -from:U0LEO', [maya.ts, dm.ts, anonymous.ts, hostile.ts]],
      ['ruleprobe -in:D0MAYA -obsolete', [maya.ts, anonymous.ts, hostile.ts]],
      ['ruleprobe has:link', [maya.ts]],
      ['ruleprobe "rollout plan"', [maya.ts, dm.ts, leo.ts]],
      ['ruleprobe "colon:value" "(ready)"', [hostile.ts]],
      [String.raw`ruleprobe "quoted \"plan\""`, [hostile.ts]],
      ['ruleprobe "🚀 café"', [hostile.ts]],
      ['ruleprobe cafe', [hostile.ts]],
      ['ruleprobe from:missing', []],
      ['ruleprobe is:saved', []],
      ['ruleprobe has:pin', []],
    ]
    for (const [text, expected] of cases) {
      const local = liveQuery(searchQuery)({ query: text, limit: 50, places: false })
      const release = engine.registry.mount(local)
      const rows = await waitFor(() => { const result = engine.registry.get(local); return result._tag === 'Success' ? result.value : undefined })
      release()
      expect(rows.flatMap((row) => row.kind === 'message' ? [row.ts] : []).toSorted(), `local ${text}`).toEqual([...expected].sort())
      const found = session(engine, parseSearchQuery(text), text)
      const result = await found.until((s) => s.state === 'done')
      expect(result.groups.flatMap((g) => g.messages.map((m) => m.ts)).toSorted(), text).toEqual([...expected].sort())
    }
    const bots = await session(engine, parseSearchQuery('ruleprobe from:U0GRAFANA', { scope: { hideApps: false } }), 'bots').until((s) => s.state === 'done')
    expect(bots.groups.flatMap((g) => g.messages.map((m) => m.ts))).toEqual([bot.ts])
  })
  await step('hidden-only results can be revealed, and an explicit channel overrides Automated hiding', async () => {
    fake.workspace.post({ channel: 'C0ENG', user: 'U0GRAFANA', text: 'hiddenonlyprobe bot' })
    fake.workspace.post({ channel: 'D0MAYA', user: 'U0MAYA', text: 'hiddenonlyprobe automated' })
    valueOf(await runCommand(registry, viewsSortChannel, { channel: 'D0MAYA', to: 'automated' }))
    const hidden = await session(engine, parseSearchQuery('hiddenonlyprobe'), 'hidden').until((s) => s.state === 'onlyHidden')
    expect(ids(hidden)).toEqual([])
    expect(hidden.counts.hidden).toBe(2)
    const shown = await session(engine, parseSearchQuery('hiddenonlyprobe', { scope: { hideApps: false, hideAutomated: false } }), 'shown').until((s) => s.state === 'done')
    expect(ids(shown)).toHaveLength(2)
    const scoped = await session(engine, parseSearchQuery('hiddenonlyprobe in:D0MAYA'), 'explicit').until((s) => s.state === 'done')
    expect(ids(scoped)).toHaveLength(1)
  })
  await step('automated rows thin the first page and thread scope filters every page', async () => {
    const now = fake.now()
    const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'scopedprobe root', at: now - 100_000 })
    fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'scopedprobe reply', threadTs: root.ts, at: now - 99_000 })
    await localReady(engine, 'scopedprobe', 2)
    for (let i = 0; i < 55; i++) fake.workspace.post({ channel: 'D0MAYA', user: 'U0MAYA', text: 'scopedprobe automated', at: now - 3000 - i * 1000, silent: true })
    const thin = await session(engine, parseSearchQuery('scopedprobe'), 'thin').until((s) => s.state === 'done')
    expect(thin.pagination.page).toBe(2)
    expect(ids(thin)).toHaveLength(2)
    const scoped = await session(engine, parseSearchQuery('scopedprobe', { scope: { topic: { channel: 'C0ENG', threadTs: root.ts }, groupByThread: true } }), 'topic').until((s) => s.state === 'done')
    expect(ids(scoped)).toEqual(ids(thin))
    expect(scoped.groups).toHaveLength(1)
    expect(scoped.groups[0]?.kind).toBe('thread')
    valueOf(await runCommand(registry, topicsRename, { id: `t:C0ENG:${root.ts}`, title: 'Named title needle' }))
    const title = await session(engine, parseSearchQuery('"Named title needle" from:U0MAYA in:C0ENG'), 'title-author').until((s) => s.state === 'done')
    expect(title.groups).toEqual([expect.objectContaining({ kind: 'topic', topicId: `t:C0ENG:${root.ts}`, title: 'Named title needle' })])
    const wrongAuthor = await session(engine, parseSearchQuery('"Named title needle" from:U0LEO in:C0ENG'), 'title-other').until((s) => s.state === 'done')
    expect(wrongAuthor.groups).toEqual([])
  })
}, 90_000)

it('retains local rows on Slack failure; pins wait for Slack; offline and palette searches make no remote search', async () => {
  const engine = await syncedEngine(engines)
  const { fake } = engine
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'failureprobe local' })
  await localReady(engine, 'failureprobe', 1)
  fake.resetCalls()
  await localReady(engine, 'failureprobe', 1)
  expect(fake.callCount('search.modules.messages')).toBe(0)
  fake.forceError({ method: 'search.modules.messages', error: 'invalid_args' })
  const failed = session(engine, parseSearchQuery('failureprobe'), 'failure')
  const failure = await failed.until((s) => s.state === 'slackUnavailable')
  expect(ids(failure)).toHaveLength(1)
  expect(valueOf(await runCommand(engine.registry, searchMore, { sessionId: 'failure', generation: 1 }))).toBe(true)
  await failed.until((s) => s.state === 'done')
  fake.holdNext({ method: 'search.modules.messages', reason: 'search' })
  const pins = session(engine, parseSearchQuery('failureprobe has:pin'), 'pins')
  const pending = await pins.until((s) => s.state === 'searching')
  expect(pending.needsSlack).toBe(true)
  expect(ids(pending)).toEqual([])
  await waitFor(() => fake.heldCount({ method: 'search.modules.messages' }) > 0 ? true : undefined)
  fake.release({ method: 'search.modules.messages' })
  await pins.until((s) => s.state === 'done')
  fake.goOffline()
  await engine.phase('offline')
  fake.resetCalls()
  const offline = await session(engine, parseSearchQuery('failureprobe has:pin'), 'offline').until((s) => s.state === 'offline')
  expect(offline.needsSlack).toBe(true)
  expect(ids(offline)).toEqual([])
  expect(fake.callCount('search.modules.messages')).toBe(0)
}, 90_000)
