// The built-in Automated view (SPEC section 5, "Automated") against the
// fake Slack and the fake AI: clear bot channels are in it when the first
// sync reports live, later moves in and back out are recorded for Home, an
// ambiguous channel is asked about on Home, answers stick, a hand-placed
// channel is never moved, and a deleted view stays deleted.
import { afterEach, describe, expect, it } from 'vitest'
import { homeMovesSeen, homeView, viewsDelete, viewsList, viewsRemoveChannel, viewsSortChannel, type HomeView, type SidebarView } from '@juno/contract'
import type { FakeSlack } from '@juno/fake-slack'
import { liveQuery, runCommand } from '@juno/state'
import { sleep, waitFor, WAIT_MS, type RunningEngine } from './harness'
import { bootedEngine, valueOf } from './scenario'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

function valueUntil<A>(engine: RunningEngine, atom: Parameters<RunningEngine['registry']['mount']>[0], predicate: (value: A) => boolean, label: string): Promise<A> {
  unmounts.push(engine.registry.mount(atom))
  return waitFor(() => {
    const result = engine.registry.get(atom) as { _tag: string; value?: A }
    return result._tag === 'Success' && predicate(result.value!) ? { value: result.value! } : undefined
  }, WAIT_MS, label).then((found) => found.value)
}

const viewsUntil = (engine: RunningEngine, predicate: (views: ReadonlyArray<SidebarView>) => boolean, label: string) =>
  valueUntil<ReadonlyArray<SidebarView>>(engine, liveQuery(viewsList)(undefined), predicate, label)
const homeUntil = (engine: RunningEngine, predicate: (view: HomeView) => boolean, label: string) =>
  valueUntil<HomeView>(engine, liveQuery(homeView)(undefined), predicate, label)

const automatedOf = (views: ReadonlyArray<SidebarView>) => views.find((view) => view.id === 'automated')
const holds = (views: ReadonlyArray<SidebarView>, channel: string) => automatedOf(views)?.channels.some((c) => c.id === channel) === true
const channelsOf = (rows: ReadonlyArray<{ readonly channel: { readonly id: string } }>) => new Set(rows.map((row) => row.channel.id))

const RELEASES = 'C0RELEASES'

/** The job takes changes in 3 second windows: after this, a pass has looked at what changed. */
const afterAPass = () => sleep(4000)

/** More top-level posts from the deploy bot than from people, but not nearly all: the rules cannot tell, nor can the fake AI. */
function addReleases(fake: FakeSlack): void {
  fake.addChannel({
    id: RELEASES,
    name: 'releases',
    messages: [
      { user: 'U0DEPLOYBOT', text: 'web 2.3.0 tagged', ago: 60 },
      { user: 'U0SAM', text: 'Release notes for 2.3 are in the doc.', ago: 55 },
      { user: 'U0DEPLOYBOT', text: 'api 1.9.0 tagged', ago: 50 },
      { user: 'U0PRIYA', text: 'Can we hold 2.3 until the icons land?', ago: 45 },
      { user: 'U0DEPLOYBOT', text: 'web 2.3.1 tagged', ago: 40 },
      { user: 'U0SAM', text: 'Sure, Friday then.', ago: 35 },
      { user: 'U0DEPLOYBOT', text: 'web 2.3.2 tagged', ago: 30 },
    ],
  })
}

const withReleases = { initial: (fake: FakeSlack) => (addReleases(fake), fake.signIn()) }

describe('the Automated view', () => {
  it('holds the bot channels when the first sync is live, and keeps them out of All', async () => {
    const engine = await bootedEngine(engines, { aiJobs: true })
    const views = await viewsUntil(engine, (list) => automatedOf(list) !== undefined, 'the Automated view')
    expect(automatedOf(views)).toMatchObject({ name: 'Automated', icon: 'robot', keepOutOfAll: true })
    expect(automatedOf(views)!.channels.map((c) => c.id).toSorted()).toEqual(['C0ALERTSPROD', 'C0DEPLOYS'])
    expect(automatedOf(views)!.addedByJuno?.toSorted()).toEqual(['C0ALERTSPROD', 'C0DEPLOYS'])

    const all = channelsOf(await engine.rows())
    expect(all.has('C0ALERTSPROD')).toBe(false)
    expect(all.has('C0ENG')).toBe(true)
    const inView = channelsOf(await engine.rows({ kind: 'all', unreadOnly: false, view: 'automated' }))
    expect([...inView].toSorted()).toEqual(['C0ALERTSPROD', 'C0DEPLOYS'])
  })

  it('asks about an ambiguous channel on Home; Move and Keep in All stick, and each undoes', async () => {
    const engine = await bootedEngine(engines, { ...withReleases, aiJobs: true })
    const home = await homeUntil(engine, (view) => view.items.some((item) => item.kind === 'automated'), 'the question on Home')
    const question = home.items.find((item) => item.kind === 'automated')!
    // The reason is Juno's, from the fake AI.
    expect(question).toMatchObject({ id: `automated:${RELEASES}`, title: 'Move #releases?', channel: { id: RELEASES, label: '#releases' }, reason: '4 of 7 messages from apps' })

    const moved = valueOf(await runCommand(engine.registry, viewsSortChannel, { channel: RELEASES, to: 'automated' }))
    expect(moved.undo).toEqual({ _tag: 'views.sortChannel', channel: RELEASES, to: 'ask' })
    await viewsUntil(engine, (list) => holds(list, RELEASES), 'releases moved')
    await homeUntil(engine, (view) => !view.items.some((item) => item.kind === 'automated'), 'the question gone')

    valueOf(await runCommand(engine.registry, viewsSortChannel, { channel: RELEASES, to: 'ask' }))
    await viewsUntil(engine, (list) => !holds(list, RELEASES), 'the move undone')
    // Asked again with the same reason.
    await homeUntil(engine, (view) => view.items.some((item) => item.id === `automated:${RELEASES}` && item.reason === question.reason), 'asked again')

    const kept = valueOf(await runCommand(engine.registry, viewsSortChannel, { channel: RELEASES, to: 'kept' }))
    expect(kept.undo).toEqual({ _tag: 'views.sortChannel', channel: RELEASES, to: 'ask' })
    await homeUntil(engine, (view) => !view.items.some((item) => item.kind === 'automated'), 'kept in All')
    // More bot messages do not move it or ask again.
    for (let n = 0; n < 8; n++) engine.fake.injectMessage({ channel: RELEASES, user: 'U0DEPLOYBOT', text: `web 2.4.${n} tagged` })
    await engine.rowsUntil((rows) => rows.some((row) => row.channel.id === RELEASES && row.preview.text === 'web 2.4.7 tagged'), 'the last tag in All')
    await afterAPass()
    expect(holds(await viewsUntil(engine, () => true, 'views'), RELEASES)).toBe(false)
    expect((await homeUntil(engine, () => true, 'home')).items.some((item) => item.kind === 'automated')).toBe(false)
  })

  it('never moves back a channel the user took out, and stays deleted once deleted', async () => {
    const engine = await bootedEngine(engines, { aiJobs: true })
    await viewsUntil(engine, (list) => holds(list, 'C0ALERTSPROD'), 'alerts in Automated')
    valueOf(await runCommand(engine.registry, viewsRemoveChannel, { id: 'automated', channel: 'C0ALERTSPROD' }))
    const views = await viewsUntil(engine, (list) => !holds(list, 'C0ALERTSPROD'), 'alerts taken out')
    expect(automatedOf(views)!.addedByJuno).toEqual(['C0DEPLOYS'])

    engine.fake.injectMessage({ channel: 'C0ALERTSPROD', user: 'U0GRAFANA', text: '[FIRING] disk 90% on db-replica-2' })
    await engine.rowsUntil((rows) => rows.some((row) => row.channel.id === 'C0ALERTSPROD' && row.preview.text.includes('disk 90%')), 'the alert in All')
    await afterAPass()
    expect(holds(await viewsUntil(engine, () => true, 'views'), 'C0ALERTSPROD')).toBe(false)

    valueOf(await runCommand(engine.registry, viewsDelete, { id: 'automated' }))
    await viewsUntil(engine, (list) => automatedOf(list) === undefined, 'deleted')
    engine.fake.injectMessage({ channel: 'C0DEPLOYS', user: 'U0DEPLOYBOT', text: 'web@aa11 deployed to prod' })
    await engine.rowsUntil((rows) => rows.some((row) => row.channel.id === 'C0DEPLOYS' && row.preview.text.includes('aa11')), 'deploys back in All')
    await afterAPass()
    expect(automatedOf(await viewsUntil(engine, () => true, 'views'))).toBeUndefined()
  })
})

describe("Automated's record", () => {
  it('sorts a channel the user joins later, once its bot has written a few messages', async () => {
    const engine = await bootedEngine(engines, { aiJobs: true })
    const now = engine.fake.now()
    engine.fake.workspace.addConversation({ id: 'C0BUILDS', name: 'builds', kind: 'public', members: new Set(['U0DEPLOYBOT']), created: now, topic: '', purpose: '', isOpen: true, archived: false })
    engine.fake.joinChannel({ channel: 'C0BUILDS' })
    for (let n = 1; n <= 5; n++) engine.fake.injectMessage({ channel: 'C0BUILDS', user: 'U0DEPLOYBOT', text: `main #${n} passed` })
    const views = await viewsUntil(engine, (list) => holds(list, 'C0BUILDS'), 'the new channel in Automated')
    expect(automatedOf(views)!.addedByJuno).toContain('C0BUILDS')

    // Moved after the first sync, so Home's record says so, with the counts the rule read.
    const home = await homeUntil(engine, (view) => view.items.some((item) => item.kind === 'automatedMoves'), 'the record on Home')
    const record = home.items.find((item) => item.kind === 'automatedMoves')!
    expect(record.title).toBe('Juno moved 1 channel to Automated')
    expect(record.topics.map((topic) => topic.moved)).toEqual([
      expect.objectContaining({ change: 'in', channel: expect.objectContaining({ id: 'C0BUILDS', label: '#builds' }), reason: expect.stringMatching(/^Apps wrote \d+ of the last \d+ top-level messages$/) }),
    ])

    // Shown once: then it waits.
    valueOf(await runCommand(engine.registry, homeMovesSeen, { channels: ['C0BUILDS'] }))
    await homeUntil(engine, (view) => !view.items.some((item) => item.kind === 'automatedMoves'), 'the record seen')
  })

  it('takes a channel back out once people start most conversations there, and the record says so', async () => {
    const engine = await bootedEngine(engines, { aiJobs: true })
    await viewsUntil(engine, (list) => holds(list, 'C0ALERTSPROD'), 'alerts in Automated')
    // The first sync's own sorting is not news.
    expect((await homeUntil(engine, () => true, 'home')).items.some((item) => item.kind === 'automatedMoves')).toBe(false)

    // Its name says alerts, so people must start seven in ten: 21 of the latest 30 top-level messages.
    for (let n = 0; n < 21; n++) engine.fake.injectMessage({ channel: 'C0ALERTSPROD', user: n % 2 === 0 ? 'U0SAM' : 'U0PRIYA', text: `Looking at the p95 spike, part ${n}` })
    await viewsUntil(engine, (list) => !holds(list, 'C0ALERTSPROD'), 'alerts moved back')
    const home = await homeUntil(engine, (view) => view.items.some((item) => item.kind === 'automatedMoves'), 'the record on Home')
    const record = home.items.find((item) => item.kind === 'automatedMoves')!
    expect(record.title).toBe('Juno moved 1 channel out of Automated')
    expect(record.topics[0]!.moved).toMatchObject({ change: 'out', reason: 'Moved back: people start most conversations here', detail: 'People wrote 21 of the last 30 top-level messages' })
    expect(channelsOf(await engine.rows()).has('C0ALERTSPROD')).toBe(true)
  })
})
