// Home's rules against the fake Slack (SPEC 12): an unread message that asks nothing makes no row, a DM set to
// Never leaves Home, and a missed huddle (SPEC 20, "Missed huddles") shows once it ended unseen, from the socket
// or from history, until it is opened. The AI items are in `ai-jobs.flow.test.ts`.
import { afterEach, expect, it } from 'bun:test'
import { channelsIgnore, homeHuddleSeen, homeView, huddleIncoming, notificationsSetLevel, type HomeItem, type HomeView, type IncomingHuddle } from '@juno/contract'
import { SELF_ID, TEAM, type Workspace } from '@juno/fake-slack'
import { dismissHuddle, liveQuery, runCommand, setTidyUpPrefs, tidyUpPrefsAtom } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { bootedEngine, readDb, restart, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

const DAY = 24 * 60 * 60_000

function liveUntil<A>(engine: RunningEngine, atom: Parameters<RunningEngine['registry']['mount']>[0], predicate: (value: A) => boolean, label: string): Promise<A> {
  unmounts.push(engine.registry.mount(atom))
  return waitFor(() => {
    const result = engine.registry.get(atom) as { _tag: string; value?: A }
    return result._tag === 'Success' && predicate(result.value as A) ? { value: result.value as A } : undefined
  }, WAIT_MS, label).then((found) => found.value)
}

const homeUntil = (engine: RunningEngine, predicate: (view: HomeView) => boolean, label: string) =>
  liveUntil<HomeView>(engine, liveQuery(homeView)(undefined), (view) => view.ready && predicate(view), label)

/** Home as a new subscription reads it now, for a check that something is not there. */
async function homeNow(engine: RunningEngine): Promise<HomeView> {
  const window = engine.openWindow()
  const atom = liveQuery(homeView)(undefined)
  const unmount = window.mount(atom)
  try {
    return await waitFor(() => {
      const result = window.get(atom)
      return result._tag === 'Success' && result.value.ready ? result.value : undefined
    }, WAIT_MS, 'Home now')
  } finally {
    unmount()
  }
}

/** The huddles of `channel` the store has recorded as ended. */
const endedIn = (engine: RunningEngine, channel: string) =>
  readDb(engine, 'user.db', (db) => (db.prepare('SELECT count(*) AS n FROM huddle_history WHERE channel = ? AND ended_at IS NOT NULL').get(channel) as { n: number }).n)
const incomingUntil = (engine: RunningEngine, predicate: (incoming: ReadonlyArray<IncomingHuddle>) => boolean, label: string) =>
  liveUntil<ReadonlyArray<IncomingHuddle>>(engine, liveQuery(huddleIncoming)(undefined), predicate, label)
const missed = (view: HomeView): ReadonlyArray<HomeItem> => view.items.filter((item) => item.kind === 'missedHuddle')
const missedIn = (view: HomeView) => missed(view).map((item) => item.topics[0]!.id)
const shows = (view: HomeView, topicId: string) => view.items.some((item) => item.topics.some((topic) => topic.id === topicId))

/** Leo asks in a DM, and #general is read: one row. */
function oneQuestion(workspace: Workspace): void {
  const now = workspace.clock.now()
  for (const [id, name] of [[SELF_ID, 'Sam Ortiz'], ['U0LEO', 'Leo Park']] as const) {
    workspace.addUser({ id, team_id: TEAM.id, name, real_name: name, profile: { display_name: name } })
  }
  workspace.addConversation({ id: 'C0QUIET', name: 'general', kind: 'public', members: new Set([SELF_ID, 'U0LEO']), created: now - 90 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
  workspace.reads.set('C0QUIET', workspace.post({ channel: 'C0QUIET', user: 'U0LEO', text: 'Release notes are out.', at: now - 60 * 60_000, silent: true }).ts)
  workspace.addConversation({ id: 'D0LEO', name: '', kind: 'im', members: new Set([SELF_ID, 'U0LEO']), created: now - 90 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
  workspace.post({ channel: 'D0LEO', user: 'U0LEO', text: 'Can you check the release notes today?', at: now - 30 * 60_000 })
}

it('with no rows, the first Home is caught up even while a DM is unread', async () => {
  // The user answered Leo's question; his later message asks nothing.
  const engine = await bootedEngine(engines, {
    fakeOptions: {
      seed: (workspace) => {
        oneQuestion(workspace)
        workspace.post({ channel: 'D0LEO', user: 'U0LEO', text: 'Release notes are out.', at: workspace.clock.now() - 10 * 60_000 })
        workspace.reads.set('D0LEO', workspace.post({ channel: 'D0LEO', user: SELF_ID, text: 'Done, checked them.', at: workspace.clock.now() - 20 * 60_000 }).ts)
      },
    },
  })
  const rows = await engine.rowsUntil((list) => list.some((row) => row.id === 'm:D0LEO'), 'Leo’s DM')
  expect(rows.find((row) => row.id === 'm:D0LEO')!.unreadCount).toBeGreaterThan(0)
  expect((await homeNow(engine)).items).toEqual([])
})

it('a DM set to Never leaves Home, and comes back when set to Auto', async () => {
  const engine = await syncedEngine(engines)
  const setMaya = async (choice: 'never' | 'auto') => valueOf(await runCommand(engine.registry, notificationsSetLevel, { target: { kind: 'person', id: 'U0MAYA' }, choice }))
  engine.fake.injectMessage({ channel: 'D0MAYA', user: 'U0MAYA', text: 'Can you look at the hiring plan today?' })
  await homeUntil(engine, (view) => shows(view, 'm:D0MAYA'), 'Maya’s question on Home')
  await setMaya('never')
  await homeUntil(engine, (view) => !shows(view, 'm:D0MAYA'), 'Maya gone from Home')
  await setMaya('auto')
  const back = await homeUntil(engine, (view) => shows(view, 'm:D0MAYA'), 'Maya back on Home')
  expect(back.items.find((item) => shows({ ...back, items: [item] }, 'm:D0MAYA'))!.kind).toBe('waiting')
})

it('Settings › Tidy up keeps two quick changes to separate controls, made before either is saved', async () => {
  const engine = await syncedEngine(engines)
  unmounts.push(engine.registry.mount(tidyUpPrefsAtom))
  expect(engine.registry.get(tidyUpPrefsAtom)).toMatchObject({ threads: true, dms: true })
  setTidyUpPrefs(engine.registry, { threads: false })
  setTidyUpPrefs(engine.registry, { dms: false })
  await waitFor(() => (engine.registry.get(tidyUpPrefsAtom).dms ? undefined : true), WAIT_MS, 'the second change saved')
  const window = engine.openWindow()
  unmounts.push(window.mount(tidyUpPrefsAtom))
  await waitFor(() => (window.get(tidyUpPrefsAtom).dms ? undefined : true), WAIT_MS, 'the saved settings read again')
  expect(window.get(tidyUpPrefsAtom)).toMatchObject({ threads: false, dms: false })
})

it('a dismissed huddle shows as missed once it ends and opening it clears it; Never hides one, Always shows it even in an ignored channel, and a restart keeps them cleared', async () => {
  const engine = await syncedEngine(engines)
  const { registry, fake } = engine

  await step('a dismissed huddle shows as missed after it ends, and opening it clears it', async () => {
    fake.control('startHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
    const [incoming] = await incomingUntil(engine, (list) => list.some((huddle) => huddle.channelId === 'D0MAYA'), 'the incoming card')
    valueOf(await dismissHuddle(registry, incoming!.callId))
    await incomingUntil(engine, (list) => list.length === 0, 'the card dismissed')
    fake.control('endHuddle', { channel: 'D0MAYA' })
    const view = await homeUntil(engine, (value) => missedIn(value).includes('m:D0MAYA'), 'the missed huddle')
    const item = missed(view).find((each) => each.topics[0]!.id === 'm:D0MAYA')!
    // The meta line reads "Lasted under a minute".
    expect([item.title, item.durationMinutes]).toEqual(['Missed huddle with Maya', 0])
    valueOf(await runCommand(registry, homeHuddleSeen, { callId: item.huddleId! }))
    await homeUntil(engine, (value) => missed(value).length === 0, 'the miss cleared')
  })

  await step('Never hides a missed huddle, Always shows it, and ignoring the channel does not hide it', async () => {
    const product = { kind: 'channel', id: 'C0PRODUCT' } as const
    valueOf(await runCommand(registry, notificationsSetLevel, { target: product, choice: 'never' }))
    fake.control('startHuddle', { channel: 'C0PRODUCT', user: 'U0LEO' })
    fake.control('endHuddle', { channel: 'C0PRODUCT' })
    await waitFor(() => (endedIn(engine, 'C0PRODUCT') > 0 ? true : undefined), WAIT_MS, 'the huddle in #product recorded')
    expect(missedIn(await homeNow(engine))).toEqual([])
    valueOf(await runCommand(registry, notificationsSetLevel, { target: product, choice: 'always' }))
    valueOf(await runCommand(registry, channelsIgnore, { channel: 'C0PRODUCT' }))
    const view = await homeUntil(engine, (value) => missedIn(value).includes('m:C0PRODUCT'), 'the miss in #product')
    expect(missed(view)[0]!.title).toBe('Missed huddle in #product')
    valueOf(await runCommand(registry, homeHuddleSeen, { callId: missed(view)[0]!.huddleId! }))
    await homeUntil(engine, (value) => missed(value).length === 0, 'the miss cleared')
  })

  await step('opened misses stay cleared across a restart', async () => {
    for (const unmount of unmounts.splice(0)) unmount()
    const next = await restart(engines, engine)
    expect(missed(await homeNow(next))).toEqual([])
  })
})

it('history recovers a miss made while Juno was closed, and none from a joined, expired or half-recorded huddle or an earlier join in the same second; a later join elsewhere clears it', async () => {
  const engine = await bootedEngine(engines, {
    initial: (fake) => {
      // Eight days ago, with Sam: too old to be called missed.
      fake.workspace.clock.set(Date.now() - 8 * DAY)
      fake.control('startHuddle', { channel: 'D0SAM', user: 'U0SAM' })
      fake.control('endHuddle', { channel: 'D0SAM' })
      // A minute ago, with Maya: the user joined one, and missed a later one in the same second.
      fake.workspace.clock.set(Date.now() - 60_000)
      fake.control('startHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
      fake.control('joinHuddle', { channel: 'D0MAYA', user: SELF_ID })
      fake.control('endHuddle', { channel: 'D0MAYA' })
      fake.control('startHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
      fake.control('endHuddle', { channel: 'D0MAYA' })
      fake.workspace.clock.resume()
      // Joining even briefly means this huddle in #eng was not missed.
      fake.control('startHuddle', { channel: 'C0ENG', user: 'U0LEO' })
      fake.control('joinHuddle', { channel: 'C0ENG', user: SELF_ID })
      fake.control('leaveHuddle', { channel: 'C0ENG', user: SELF_ID })
      fake.control('endHuddle', { channel: 'C0ENG' })
      // A huddle in #product whose participation history Slack left out is not called missed.
      fake.control('startHuddle', { channel: 'C0PRODUCT', user: 'U0LEO' })
      fake.control('endHuddle', { channel: 'C0PRODUCT' })
      const list = fake.workspace.all('C0PRODUCT')
      const at = list.findIndex((message) => message.room !== undefined)
      const message = list[at]!
      const { participant_history: _history, ...room } = message.room!
      list[at] = { ...message, room }
      return fake.signIn()
    },
  })

  await step('only the later Maya huddle is missed, and no card rings for it', async () => {
    expect(missedIn(await homeNow(engine))).toEqual(['m:D0MAYA'])
    expect(await incomingUntil(engine, () => true, 'the incoming huddles')).toEqual([])
  })

  await step('joining a later huddle with Maya from another device clears it', async () => {
    engine.fake.control('startHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
    engine.fake.control('joinHuddle', { channel: 'D0MAYA', user: SELF_ID })
    engine.fake.control('endHuddle', { channel: 'D0MAYA' })
    await homeUntil(engine, (view) => missed(view).length === 0, 'the miss cleared')
  })
})
