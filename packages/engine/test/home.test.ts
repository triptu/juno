// Home (SPEC section 12): what wants the user, from the local cache, against
// the fake Slack and the fake AI provider.
import { afterEach, describe, expect, it } from 'vitest'
import { homeMarkDone, homeView, homeVisit, prefsSet, type HomeView } from '@juno/contract'
import { liveQuery, runCommand } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { bootedEngine, threadId, valueOf } from './scenario'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

function homeUntil(engine: RunningEngine, predicate: (value: HomeView) => boolean, label: string): Promise<HomeView> {
  const atom = liveQuery(homeView)(undefined)
  unmounts.push(engine.registry.mount(atom))
  return waitFor(() => {
    const result = engine.registry.get(atom) as { _tag: string; value?: HomeView }
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
    const engine = await bootedEngine(engines)
    const first = await homeUntil(engine, (view) => view.ready && view.items.length > 0, 'the first subscription')
    for (const unmount of unmounts.splice(0)) unmount()
    // Past the renderer's idle time, so the subscription ends and a new one starts.
    await new Promise((resolve) => setTimeout(resolve, 31_000))
    const again = await homeUntil(engine, (view) => view.ready, 'the second subscription')
    expect(again.items.map((item) => item.id)).toContain(first.items[0]!.id)
  }, 90_000)

  it('with AI assist off, ranks what waits, where the user left off and what moved, and adds nothing from the assistant', async () => {
    const engine = await bootedEngine(engines)
    valueOf(await runCommand(engine.registry, prefsSet, { key: 'aiAssist', value: false }))

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
    const engine = await bootedEngine(engines)
    // A second settled thread: a closing reply five minutes ago, so it has been idle long enough to score.
    const root = engine.fake.messages('C0ENG').find((message) => message.text?.startsWith('Unrelated: has anyone looked at the staging bill'))!
    const staging = `t:C0ENG:${root.ts}`
    engine.fake.workspace.post({ channel: 'C0ENG', threadTs: root.ts, user: 'U0JONAS', text: 'Reaper is live. Done, thanks all.', at: engine.fake.now() - 5 * 60_000 })

    const view = await homeUntil(engine, (value) => kinds(value).join() === 'waiting,followUp,tidyUp' && value.items[0]!.aiTitle !== undefined, 'the AI items')
    expect(view.items[0]!.aiTitle).toBe('Elena asks: She has a competing offer with a Friday')
    const followUp = view.items[1]!
    expect(followUp).toMatchObject({ title: "You said you'd review Dev's packet this week", topics: [{ place: 'Sam' }] })
    const tidy = view.items[2]!
    expect(tidy.title).toBe('2 topics look settled')
    expect(tidy.topics.map((topic) => topic.id)).toContain(staging)

    valueOf(await runCommand(engine.registry, homeMarkDone, { topicId: followUp.topics[0]!.id, messageTs: followUp.messageTs! }))
    const done = await homeUntil(engine, (value) => !kinds(value).includes('followUp'), 'the follow-up gone')
    expect(kinds(done)).toEqual(['waiting', 'tidyUp'])
  })
})
