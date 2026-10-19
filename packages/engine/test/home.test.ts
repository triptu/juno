// Home (SPEC section 12): what wants the user, from the local cache, against
// the fake Slack and the fake AI provider.
import { afterEach, describe, expect, it } from 'vitest'
import { homeMarkDone, homeView, homeVisit, prefsSet, type HomeView } from '@juno/contract'
import { SELF_ID } from '@juno/fake-slack'
import { liveQuery, runCommand, type Registry } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { bootedEngine, restart, threadId, valueOf } from './scenario'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

function homeUntil(engine: RunningEngine, predicate: (value: HomeView) => boolean, label: string, registry: Registry = engine.registry): Promise<HomeView> {
  const atom = liveQuery(homeView)(undefined)
  unmounts.push(registry.mount(atom))
  return waitFor(() => {
    const result = registry.get(atom) as { _tag: string; value?: HomeView }
    return result._tag === 'Success' && predicate(result.value!) ? { value: result.value! } : undefined
  }, WAIT_MS, label).then((found) => found.value)
}

const kinds = (view: HomeView) => view.items.map((item) => item.kind)

/** Nine replies from Leo in a thread, so it moved a lot. */
function burst(engine: RunningEngine, channel: string, threadTs: string, count = 9): void {
  for (let n = 1; n <= count; n++) engine.fake.injectMessage({ channel, threadTs, user: 'U0LEO', text: `Update ${n} on the plan.` })
}

describe('Home', () => {
  it('answers a second subscription with the current value at once', async () => {
    const engine = await bootedEngine(engines, { aiJobs: true })
    const first = await homeUntil(engine, (view) => view.ready && view.items.length > 0, 'the first subscription')
    for (const unmount of unmounts.splice(0)) unmount()
    // A new subscription to the same engine: a second window, as a remount after the renderer's idle time would be.
    const again = await homeUntil(engine, (view) => view.ready, 'the second subscription', engine.openWindow())
    expect(again.items.map((item) => item.id)).toContain(first.items[0]!.id)
  })

  it('with AI assist off, ranks what waits, where the user left off and what moved, and adds nothing from the assistant', async () => {
    // Persist AI assist off before any background job can title the fixture.
    const setup = await bootedEngine(engines)
    valueOf(await runCommand(setup.registry, prefsSet, { key: 'aiAssist', value: false }))
    const engine = await restart(engines, setup, () => {}, { aiJobs: true })
    await engine.workPass('title')
    await engine.workPass('home')

    const first = await homeUntil(engine, (view) => view.items.length > 0, 'a waiting item')
    expect(first.firstName).toBe('Tushar')
    expect(first.items[0]).toMatchObject({ kind: 'waiting', title: 'Elena asked you something', topics: [{ title: 'Rina finished the onsite. Panel notes…', place: 'hiring' }] })
    expect(first.items[0]!.aiTitle).toBeUndefined()

    const postgres = threadId(engine.fake, 'C0ENG', 'Draft plan is in the doc')
    valueOf(await runCommand(engine.registry, homeVisit, { id: postgres }))
    burst(engine, 'C0ENG', postgres.split(':')[2]!)
    const resumed = await homeUntil(engine, (view) => kinds(view).includes('resume'), 'pick up where you left off')
    // The visited topic shows once, under its higher kind.
    expect(resumed.items.filter((item) => item.topics.some((topic) => topic.id === postgres)).map((item) => item.kind)).toEqual(['resume'])

    const staging = threadId(engine.fake, 'C0ENG', 'Unrelated: has anyone looked at the staging bill')
    burst(engine, 'C0ENG', staging.split(':')[2]!)
    // The item shows from MOVED_A_LOT_MIN replies on, before the last of the nine is stored.
    const moved = await homeUntil(engine, (view) => view.items.some((item) => item.kind === 'moved' && item.newCount === 9), 'moved a lot, all nine stored')
    expect(kinds(moved)).toEqual(['waiting', 'resume', 'moved'])
    expect(moved.items[2]).toMatchObject({ id: `moved:${staging}`, title: 'Moved a lot since you looked', newCount: 9 })
    expect(moved.items.every((item) => item.aiTitle === undefined)).toBe(true)
  })

  it('with AI assist on, adds a follow-up until Mark done, tidies up settled topics and rewrites a title line', async () => {
    // Seed the whole old conversation before AI can cache a score from a partial history.
    const HOUR = 3_600_000
    let keys = ''
    const engine = await bootedEngine(engines, { aiJobs: true, initial: (fake) => {
      const root = fake.workspace.post({ channel: 'C0INCIDENTS', user: 'U0DEV', text: 'The staging deploy keys need rotating before Friday', at: fake.now() - 3 * HOUR })
      fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts, user: SELF_ID, text: 'Rotated them this morning.', at: fake.now() - 2.5 * HOUR })
      fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts, user: 'U0DEV', text: 'Great, thanks', at: fake.now() - 2 * HOUR })
      keys = `t:C0INCIDENTS:${root.ts}`
      return fake.signIn()
    } })
    // The fixture incident went quiet 70 minutes ago; one hour makes it eligible.
    valueOf(await runCommand(engine.registry, prefsSet, { key: 'tidyUp', value: { quiet: '1h', threads: true, dms: true } }))

    const view = await homeUntil(engine, (value) => kinds(value).join() === 'waiting,followUp,tidyUp' && value.items[0]!.aiTitle !== undefined, 'the AI items')
    expect(view.items[0]!.aiTitle).toBe('Elena asks: She has a competing offer with a Friday')
    const followUp = view.items[1]!
    expect(followUp).toMatchObject({ title: "You said you'd review Dev's packet this week", topics: [{ place: 'Sam' }] })
    const tidy = view.items[2]!
    expect(tidy.title).toBe('2 topics look settled')
    // Each proposal says why, from its last messages, with the writer's first name.
    expect(tidy.topics.find((topic) => topic.id === keys)).toMatchObject({ place: 'incidents', settled: { kind: 'thanks', by: 'Dev' } })
    expect(tidy.topics.find((topic) => topic.id !== keys)?.settled).toEqual({ kind: 'thanks' })

    valueOf(await runCommand(engine.registry, homeMarkDone, { topicId: followUp.topics[0]!.id, messageTs: followUp.messageTs! }))
    const done = await homeUntil(engine, (value) => !kinds(value).includes('followUp'), 'the follow-up gone')
    expect(kinds(done)).toEqual(['waiting', 'tidyUp'])
  })
})
