// The sidebar against the fake Slack: filters swap in one step and keep
// unchanged rows as the same objects (performance 5.3), a profile change
// reaches every row, the participant stack, views (SPEC 5, "Views") and the
// built-in Automated view (SPEC 5, "Automated"). The quiet window is in
// `quiet-window.flow.test.ts`.
import { afterEach, expect, it } from 'bun:test'
import {
  homeMovesSeen,
  homeMovesShown,
  homeView,
  prefsSet,
  topicsCounts,
  topicsResolve,
  viewsAddChannel,
  viewsDelete,
  viewsList,
  viewsRemoveChannel,
  viewsReorder,
  viewsSave,
  viewsSortChannel,
  type HomeView,
  type SidebarView,
  type TopicCounts,
  type TopicRow,
} from '@juno/contract'
import { SELF_ID, type FakeSlack } from '@juno/fake-slack'
import {
  closeSidebarSheet,
  defaultTopicListFilter,
  liveQuery,
  loadSidebarMoves,
  openSidebarSheet,
  releaseSidebarTopic,
  runCommand,
  sidebarFilterAtom,
  sidebarListAtom,
  sidebarRowAtom,
  sidebarSectionsAtom,
  undoLast,
  undoStackAtom,
  type SidebarWindow,
} from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { DAY, slackWrites, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

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

const viewsUntil = (engine: RunningEngine, predicate: (views: ReadonlyArray<SidebarView>) => boolean, label: string) =>
  liveUntil<ReadonlyArray<SidebarView>>(engine, liveQuery(viewsList)(undefined), predicate, label)
const countsUntil = (engine: RunningEngine, predicate: (counts: TopicCounts) => boolean, label: string) =>
  liveUntil<TopicCounts>(engine, liveQuery(topicsCounts)({}), predicate, label)
const homeUntil = (engine: RunningEngine, predicate: (view: HomeView) => boolean, label: string) =>
  liveUntil<HomeView>(engine, liveQuery(homeView)(undefined), predicate, label)

const channelsOf = (rows: ReadonlyArray<{ readonly channel: { readonly id: string } }>) => new Set(rows.map((row) => row.channel.id))
const automatedOf = (views: ReadonlyArray<SidebarView>) => views.find((view) => view.id === 'automated')
const holds = (views: ReadonlyArray<SidebarView>, channel: string) => automatedOf(views)?.channels.some((c) => c.id === channel) === true

/** Mounts the shown window the way the list container does, and records every value it takes. */
function watchList(engine: RunningEngine) {
  const { registry } = engine
  const seen: Array<SidebarWindow> = []
  unmounts.push(registry.mount(sidebarListAtom), registry.mount(sidebarSectionsAtom), registry.subscribe(sidebarListAtom, (window) => seen.push(window)))
  const shown = (kind: string) =>
    waitFor(() => {
      const window = registry.get(sidebarListAtom)
      return window.filter.kind === kind && window.order.length > 0 ? window : undefined
    }, WAIT_MS, `the ${kind} window`)
  return { seen, shown }
}

it('the sidebar across filters, a profile change, a busy thread, own changes and views', async () => {
  const engine = await syncedEngine(engines)
  const { registry, fake } = engine
  registry.set(sidebarFilterAtom, defaultTopicListFilter)
  const { seen, shown } = watchList(engine)

  await step('a filter change keeps the old rows until the new window arrives, swaps in one step, and keeps unchanged rows as the same objects', async () => {
    const all = await shown('all')
    const shared = all.order.find((id) => all.rows.get(id)!.channel.kind === 'public')!
    let sharedNotified = 0
    const stopRow = registry.subscribe(sidebarRowAtom(shared), () => sharedNotified++)
    seen.length = 0

    registry.set(sidebarFilterAtom, { kind: 'channels', unreadOnly: false })
    // The Channels window is not in yet: the All rows stay, under their own filter.
    expect(registry.get(sidebarListAtom).filter.kind).toBe('all')
    expect(registry.get(sidebarSectionsAtom).ready).toBe(true)
    const channels = await shown('channels')
    stopRow()
    expect(seen.every((window) => window.order.length > 0)).toBe(true)
    expect(channels.order.some((id) => channels.rows.get(id)!.channel.kind === 'im')).toBe(false)
    // A row in both windows with the same rev is the same object, so its row atom did not notify.
    expect(channels.rows.get(shared)).toBe(all.rows.get(shared))
    expect(sharedNotified).toBe(0)
    const sameRev = channels.order.filter((id) => all.rows.get(id)?.rev === channels.rows.get(id)!.rev)
    expect(sameRev.length).toBeGreaterThan(0)
    for (const id of sameRev) expect(channels.rows.get(id)).toBe(all.rows.get(id))

    // Back to All while its subscription is still warm: the swap is immediate.
    registry.set(sidebarFilterAtom, defaultTopicListFilter)
    expect(registry.get(sidebarListAtom).filter.kind).toBe('all')
    expect(registry.get(sidebarListAtom).rows.get(shared)).toBe(all.rows.get(shared))
  })

  await step('a renamed person reaches every row that names them', async () => {
    const before = await engine.rowsUntil((rows) => rows.some((r) => r.participants.some((p) => p.id === 'U0LEO')), 'a row with Leo')
    const named = before.filter((r) => r.participants.some((p) => p.id === 'U0LEO')).map((r) => r.id)
    const leo = fake.workspace.users.get('U0LEO')!
    fake.emitFrame({ type: 'user_change', user: { ...leo, profile: { ...leo.profile, display_name: 'Leonard', real_name: 'Leonard Park' } }, event_ts: '1.000001' })
    const after = await engine.rowsUntil(
      (rows) => named.every((id) => rows.find((r) => r.id === id)?.participants.find((p) => p.id === 'U0LEO')?.name === 'Leonard'),
      'Leo renamed on every row',
    )
    expect(after.filter((r) => r.participants.some((p) => p.name === 'Leo')).map((r) => r.id)).toEqual([])
  })

  await step('a busy thread shows four unread senders other than you, most recent first, and counts the rest', async () => {
    const root = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Who can review the cutover runbook?' })
    // Your reply reads the thread up to it, so the root is read; the five replies after it are not.
    for (const user of [SELF_ID, 'U0LEO', 'U0SAM', 'U0PRIYA', 'U0JONAS', 'U0DEV']) fake.injectMessage({ channel: 'C0ENG', user, threadTs: root.ts, text: 'I can take a section.' })
    fake.followThread({ channel: 'C0ENG', threadTs: root.ts })
    const id = `t:C0ENG:${root.ts}`
    // Four people show while the replies are still arriving, so wait for the stack after the last one.
    const stack = (rows: ReadonlyArray<TopicRow>) => rows.find((r) => r.id === id)?.participants.map((p) => p.id).join()
    const rows = await engine.rowsUntil((all) => stack(all) === 'U0DEV,U0JONAS,U0PRIYA,U0SAM', 'the busy thread with four people')
    // Leo is the fifth unread sender; Maya's root came before your reply, so it is read.
    expect(rows.find((r) => r.id === id)!.moreParticipants).toBe(1)
  })

  await step('an own change moves rows without animation, and the next outside arrival still animates', async () => {
    await loadSidebarMoves()
    const first = fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Review motion provenance' })
    fake.followThread({ channel: 'C0ENG', threadTs: first.ts })
    const id = `t:C0ENG:${first.ts}`
    await waitFor(() => registry.get(sidebarSectionsAtom).recent.includes(id) || undefined, WAIT_MS, 'the new thread in Recent')
    expect(registry.get(sidebarSectionsAtom).moves).toBe('animate')

    releaseSidebarTopic(registry, id)
    valueOf(await runCommand(registry, topicsResolve, { id }))
    await waitFor(() => !registry.get(sidebarSectionsAtom).recent.includes(id) || undefined, WAIT_MS, 'the thread resolved')
    expect(registry.get(sidebarSectionsAtom).moves).toBe('instant')

    // A reply right after Resolve is a new outside change.
    fake.injectMessage({ channel: 'C0ENG', threadTs: first.ts, user: 'U0LEO', text: 'An outside reply reopens it' })
    await waitFor(() => registry.get(sidebarSectionsAtom).recent[0] === id || undefined, WAIT_MS, 'the thread reopened')
    expect(registry.get(sidebarSectionsAtom).moves).toBe('animate')

    // A sheet that changed nothing does not take the next outside reorder.
    openSidebarSheet(registry)
    closeSidebarSheet(registry)
    const next = fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'The next independent topic' })
    fake.followThread({ channel: 'C0ENG', threadTs: next.ts })
    await waitFor(() => registry.get(sidebarSectionsAtom).recent.includes(`t:C0ENG:${next.ts}`) || undefined, WAIT_MS, 'the next thread in Recent')
    expect(registry.get(sidebarSectionsAtom).moves).toBe('animate')
  })

  await step('a view gathers its conversations, keeps them out of All, lights its dot for a mention, undoes add, remove and delete, and writes nothing to Slack', async () => {
    const since = fake.calls.length
    // Without the built-in Automated view, which holds #alerts-prod after the first sync.
    valueOf(await runCommand(registry, viewsDelete, { id: 'automated' }))
    await engine.rowsUntil((rows) => channelsOf(rows).has('C0ALERTSPROD') && channelsOf(rows).has('C0HIRING'), 'alerts and hiring in All')

    const { id } = valueOf(await runCommand(registry, viewsSave, { name: '  Bots  ', icon: 'robot', keepOutOfAll: true, channels: ['C0ALERTSPROD'] }))
    const [view] = await viewsUntil(engine, (views) => views.length === 1, 'the new view')
    expect(view).toMatchObject({ id, name: 'Bots', keepOutOfAll: true, channels: [{ id: 'C0ALERTSPROD' }] })
    const inView = await engine.rowsUntil((rows) => rows.length > 0, 'the view', { kind: 'all', unreadOnly: false, view: id })
    expect([...channelsOf(inView)]).toEqual(['C0ALERTSPROD'])
    await engine.rowsUntil((rows) => !channelsOf(rows).has('C0ALERTSPROD') && channelsOf(rows).has('C0HIRING'), 'alerts out of All')
    await engine.rowsUntil((rows) => !channelsOf(rows).has('C0ALERTSPROD') && rows.length > 0, 'alerts out of Channels', { kind: 'channels', unreadOnly: false })
    await engine.rowsUntil((rows) => channelsOf(rows).has('C0ALERTSPROD'), 'a scope still shows it', { kind: 'all', unreadOnly: false, scope: 'C0ALERTSPROD' })

    // Plain unread lights nothing; a mention lights the view's dot.
    expect((await countsUntil(engine, () => true, 'counts')).viewMentions).toEqual([])
    fake.injectMessage({ channel: 'C0ALERTSPROD', user: 'U0LEO', text: `<@${SELF_ID}> the pager is yours tonight` })
    await countsUntil(engine, (counts) => counts.viewMentions.includes(id), 'the view dot')

    // Add and remove return each other as their undo.
    const added = valueOf(await runCommand(registry, viewsAddChannel, { id, channel: 'C0HIRING' }))
    expect(added.undo).toEqual({ _tag: 'views.removeChannel', id, channel: 'C0HIRING' })
    await engine.rowsUntil((rows) => !channelsOf(rows).has('C0HIRING'), 'hiring kept out of All too')
    expect(valueOf(await runCommand(registry, viewsAddChannel, { id, channel: 'C0HIRING' })).undo).toBeUndefined()
    valueOf(await runCommand(registry, viewsRemoveChannel, { id, channel: 'C0HIRING' }))
    await engine.rowsUntil((rows) => channelsOf(rows).has('C0HIRING'), 'hiring back in All')

    // A second view goes last; reorder moves it first.
    const second = valueOf(await runCommand(registry, viewsSave, { name: 'Team', keepOutOfAll: false, channels: ['C0ENG', 'D0SAM'] }))
    await viewsUntil(engine, (views) => views.map((v) => v.id).join() === `${id},${second.id}`, 'two views')
    valueOf(await runCommand(registry, viewsReorder, { ids: [second.id, id] }))
    await viewsUntil(engine, (views) => views[0]?.id === second.id, 'Team first')

    // Delete, then Undo: the view comes back whole, in its place, and keeps its conversations out of All again.
    const deleted = valueOf(await runCommand(registry, viewsDelete, { id }))
    await engine.rowsUntil((rows) => channelsOf(rows).has('C0ALERTSPROD'), 'alerts back in All')
    registry.set(undoStackAtom, [deleted.undo!])
    expect(await undoLast(registry)).toBe(true)
    const restored = await viewsUntil(engine, (views) => views.length === 2, 'the view restored')
    expect(restored.map((v) => v.id)).toEqual([second.id, id])
    expect(restored[1]).toMatchObject({ name: 'Bots', keepOutOfAll: true, channels: [{ id: 'C0ALERTSPROD' }] })
    await engine.rowsUntil((rows) => !channelsOf(rows).has('C0ALERTSPROD'), 'alerts out of All again')

    // Views are Juno's own.
    expect(slackWrites(engine, since)).toEqual([])
  })
}, 60_000)

/** More top-level posts from the deploy bot than from people, but not nearly all: the rules cannot tell, so Juno asks. */
function joinReleases(fake: FakeSlack): void {
  fake.workspace.addConversation({ id: 'C0RELEASES', name: 'releases', kind: 'public', members: new Set(['U0DEPLOYBOT', 'U0SAM', 'U0PRIYA']), created: fake.now() - 90 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
  fake.joinChannel({ channel: 'C0RELEASES' })
  const posts: ReadonlyArray<readonly [string, string]> = [
    ['U0DEPLOYBOT', 'web 2.3.0 tagged'], ['U0SAM', 'Release notes for 2.3 are in the doc.'], ['U0DEPLOYBOT', 'api 1.9.0 tagged'],
    ['U0PRIYA', 'Can we hold 2.3 until the icons land?'], ['U0DEPLOYBOT', 'web 2.3.1 tagged'], ['U0SAM', 'Sure, Friday then.'], ['U0DEPLOYBOT', 'web 2.3.2 tagged'],
  ]
  for (const [user, text] of posts) fake.injectMessage({ channel: 'C0RELEASES', user, text })
}

it('Automated holds bot channels, asks about an unclear one, records its own moves, and never undoes what the user decided', async () => {
  const engine = await syncedEngine(engines, { aiJobs: true, timing: { automatedWindowMillis: 300 } })
  const { registry, fake } = engine
  const afterAPass = () => engine.workPass('automated')
  const record = (view: HomeView) => view.items.find((item) => item.kind === 'automatedMoves')

  await step('holds the bot channels and keeps them out of All', async () => {
    const views = await viewsUntil(engine, (list) => holds(list, 'C0ALERTSPROD') && holds(list, 'C0DEPLOYS'), 'the bot channels in Automated')
    expect(automatedOf(views)!.addedByJuno?.toSorted()).toEqual(['C0ALERTSPROD', 'C0DEPLOYS'])
    const all = channelsOf(await engine.rows())
    expect(all.has('C0ALERTSPROD') || all.has('C0DEPLOYS')).toBe(false)
    expect(all.has('C0ENG')).toBe(true)
    expect([...channelsOf(await engine.rows({ kind: 'all', unreadOnly: false, view: 'automated' }))].toSorted()).toEqual(['C0ALERTSPROD', 'C0DEPLOYS'])
    // The first sync's own sorting is not news.
    expect(record(await homeUntil(engine, (view) => view.ready, 'Home'))).toBeUndefined()
  })

  await step('asks about an unclear channel on Home; Move and Keep in All each stick and undo', async () => {
    joinReleases(fake)
    const asked = await homeUntil(engine, (view) => view.items.some((item) => item.id === 'automated:C0RELEASES'), 'the question on Home')
    const question = asked.items.find((item) => item.id === 'automated:C0RELEASES')!
    expect(question).toMatchObject({ kind: 'automated', channel: { id: 'C0RELEASES' } })
    expect(question.reason).toBeTruthy()

    const moved = valueOf(await runCommand(registry, viewsSortChannel, { channel: 'C0RELEASES', to: 'automated' }))
    expect(moved.undo).toEqual({ _tag: 'views.sortChannel', channel: 'C0RELEASES', to: 'ask' })
    await viewsUntil(engine, (list) => holds(list, 'C0RELEASES'), 'releases moved')
    await homeUntil(engine, (view) => !view.items.some((item) => item.kind === 'automated'), 'the question gone')
    valueOf(await runCommand(registry, viewsSortChannel, { channel: 'C0RELEASES', to: 'ask' }))
    await viewsUntil(engine, (list) => !holds(list, 'C0RELEASES'), 'the move undone')
    await homeUntil(engine, (view) => view.items.some((item) => item.id === 'automated:C0RELEASES' && item.reason === question.reason), 'asked again')

    const kept = valueOf(await runCommand(registry, viewsSortChannel, { channel: 'C0RELEASES', to: 'kept' }))
    expect(kept.undo).toEqual({ _tag: 'views.sortChannel', channel: 'C0RELEASES', to: 'ask' })
    await homeUntil(engine, (view) => !view.items.some((item) => item.kind === 'automated'), 'kept in All')
    // More bot messages do not move it or ask again.
    for (let n = 0; n < 8; n++) fake.injectMessage({ channel: 'C0RELEASES', user: 'U0DEPLOYBOT', text: `web 2.4.${n} tagged` })
    await engine.rowsUntil((rows) => rows.some((row) => row.channel.id === 'C0RELEASES' && row.preview.text === 'web 2.4.7 tagged'), 'the last tag in All')
    await afterAPass()
    expect(holds(await viewsUntil(engine, () => true, 'views'), 'C0RELEASES')).toBe(false)
    expect((await homeUntil(engine, () => true, 'Home')).items.some((item) => item.kind === 'automated')).toBe(false)
  })

  await step('sorts a channel joined later once its bot has written a few messages, and Home records the move until it is seen', async () => {
    fake.workspace.addConversation({ id: 'C0BUILDS', name: 'builds', kind: 'public', members: new Set(['U0DEPLOYBOT']), created: fake.now(), topic: '', purpose: '', isOpen: true, archived: false })
    fake.joinChannel({ channel: 'C0BUILDS' })
    for (let n = 1; n <= 5; n++) fake.injectMessage({ channel: 'C0BUILDS', user: 'U0DEPLOYBOT', text: `main #${n} passed` })
    const views = await viewsUntil(engine, (list) => holds(list, 'C0BUILDS'), 'the new channel in Automated')
    expect(automatedOf(views)!.addedByJuno).toContain('C0BUILDS')
    const home = await homeUntil(engine, (view) => record(view) !== undefined, 'the record on Home')
    expect(record(home)!.topics.map((topic) => [topic.moved?.change, topic.moved?.channel.id])).toEqual([['in', 'C0BUILDS']])

    // Shown: the card waits a day, and the move stays.
    valueOf(await runCommand(registry, homeMovesShown, {}))
    await homeUntil(engine, (view) => record(view) === undefined, 'the card waiting a day')
    valueOf(await runCommand(registry, prefsSet, { key: 'automatedMovesShownAt', value: 0 }))
    const again = await homeUntil(engine, (view) => record(view) !== undefined, 'the record a day later')
    expect(record(again)!.topics.map((topic) => topic.moved?.channel.id)).toEqual(['C0BUILDS'])
    // Opened or dismissed: the move is not listed again.
    valueOf(await runCommand(registry, homeMovesSeen, { channels: ['C0BUILDS'] }))
    await homeUntil(engine, (view) => record(view) === undefined, 'the record seen')
  })

  await step('takes a channel back out once people start most conversations there, and the record says so', async () => {
    // Its name says alerts, so people must start seven in ten: 21 of the latest 30 top-level messages.
    for (let n = 0; n < 21; n++) fake.injectMessage({ channel: 'C0ALERTSPROD', user: n % 2 === 0 ? 'U0SAM' : 'U0PRIYA', text: `Looking at the p95 spike, part ${n}` })
    await viewsUntil(engine, (list) => !holds(list, 'C0ALERTSPROD'), 'alerts moved back')
    const home = await homeUntil(engine, (view) => record(view) !== undefined, 'the record on Home')
    expect(record(home)!.topics.map((topic) => [topic.moved?.change, topic.moved?.channel.id])).toEqual([['out', 'C0ALERTSPROD']])
    await engine.rowsUntil((rows) => channelsOf(rows).has('C0ALERTSPROD'), 'alerts back in All')
  })

  await step('never moves back a channel the user took out', async () => {
    valueOf(await runCommand(registry, viewsRemoveChannel, { id: 'automated', channel: 'C0DEPLOYS' }))
    const views = await viewsUntil(engine, (list) => !holds(list, 'C0DEPLOYS'), 'deploys taken out')
    expect(automatedOf(views)!.addedByJuno).not.toContain('C0DEPLOYS')
    fake.injectMessage({ channel: 'C0DEPLOYS', user: 'U0DEPLOYBOT', text: 'web@bb22 deployed to prod' })
    await engine.rowsUntil((rows) => rows.some((row) => row.channel.id === 'C0DEPLOYS' && row.preview.text.includes('bb22')), 'the deploy in All')
    await afterAPass()
    expect(holds(await viewsUntil(engine, () => true, 'views'), 'C0DEPLOYS')).toBe(false)
  })

  await step('stays deleted once deleted', async () => {
    valueOf(await runCommand(registry, viewsDelete, { id: 'automated' }))
    await viewsUntil(engine, (list) => automatedOf(list) === undefined, 'deleted')
    fake.injectMessage({ channel: 'C0BUILDS', user: 'U0DEPLOYBOT', text: 'main #6 passed' })
    await engine.rowsUntil((rows) => rows.some((row) => row.channel.id === 'C0BUILDS' && row.preview.text.includes('#6')), 'builds back in All')
    await afterAPass()
    expect(automatedOf(await viewsUntil(engine, () => true, 'views'))).toBeUndefined()
  })
}, 60_000)
