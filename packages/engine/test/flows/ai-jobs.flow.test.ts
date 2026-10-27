// The background AI jobs against the fake Slack and the fake AI: Home, thread
// titles and topic art with AI assist off and then on, follow-ups that look done, Redraw and its undo,
// a drawing the model cannot make, and what titles cost: a key change asks
// nothing again, a refused title is not asked again until the thread
// changes, the fallback model answers a refusal, and the daily budget holds.
// Calls are counted as the fake model received them; the AI activity log
// (Settings › AI activity) says which model answered.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import { aiActivity, artRedraw, followUpsRestore, homeMarkDone, homeView, homeVisit, prefsSet, tidyUpSet, type AiActivity, type HomeView, type TopicRow } from '@juno/contract'
import { SELF_ID } from '@juno/fake-slack'
import { actOnDoneFollowUp, liveQuery, redrawTopic, runAction, runCommand, topicAtom, undoLast, undoOne } from '@juno/state'
import { parseRecipe } from '@juno/topic-art'
import { TITLE_DAILY_BUDGET } from '../../src/titleJob'
import { controlledSleep } from '../controlledClock'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { restart, threadId, tsOf, valueOf } from '../scenario'
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

const homeUntil = (engine: RunningEngine, predicate: (view: HomeView) => boolean, label: string) =>
  liveUntil<HomeView>(engine, liveQuery(homeView)(undefined), predicate, label)
const activityUntil = (engine: RunningEngine, predicate: (activity: AiActivity) => boolean, label: string) =>
  liveUntil<AiActivity>(engine, liveQuery(aiActivity)(undefined), predicate, label)

const kinds = (view: HomeView) => view.items.map((item) => item.kind)
const threads = (rows: ReadonlyArray<TopicRow>) => rows.filter((row) => row.kind === 'thread')
const allTitled = (rows: ReadonlyArray<TopicRow>) => threads(rows).length > 0 && threads(rows).every((row) => row.titleSource === 'ai')
const isDmMain = (row: TopicRow) => row.kind === 'main' && (row.channel.kind === 'im' || row.channel.kind === 'mpim')
const hasArt = (row: TopicRow) => typeof row.art === 'string' && row.art.length > 0

/** Calls of a task that reached the fake model on this engine. */
const calls = (engine: RunningEngine, task: 'titleTopic' | 'topicArt') =>
  engine.main.host.fromEngine.filter((message) => message._tag === 'aiCall' && message.task === task).length

const setPref = async (engine: RunningEngine, key: string, value: unknown) => valueOf(await runCommand(engine.registry, prefsSet, { key, value: value as never }))

/** A thread posted now in #eng with a reply from the signed-in user, so Slack follows it and it enters the sidebar. */
function liveThread(engine: RunningEngine, text: string): string {
  const root = engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text })
  engine.fake.injectMessage({ channel: 'C0ENG', user: SELF_ID, text: 'Looking.', threadTs: root.ts })
  return `t:C0ENG:${root.ts}`
}

/** Runs art passes until one asks the model for nothing new: every candidate then has a finished attempt. */
async function drawAll(engine: RunningEngine): Promise<void> {
  for (let pass = 0; pass < 10; pass++) {
    const before = calls(engine, 'topicArt')
    await engine.workPass('art')
    if (calls(engine, 'topicArt') === before) return
  }
  throw new Error('art passes kept drawing')
}

/** Nine replies from Leo in a thread, so it moved a lot. */
function burst(engine: RunningEngine, id: string): void {
  for (let n = 1; n <= 9; n++) engine.fake.injectMessage({ channel: 'C0ENG', threadTs: tsOf(id), user: 'U0LEO', text: `Update ${n} on the plan.` })
}

it('Home, titles and drawings with AI assist off, then on: Redraw and undo, hidden while off, and a drawing the model cannot make', async () => {
  // Art passes run only when the test asks, so each count is around one known pass.
  const time = await controlledSleep(30_000)
  try {
    const setup = await syncedEngine(engines)
    await setPref(setup, 'aiAssist', false)
    const engine = await restart(engines, setup, () => {}, { aiJobs: true, clock: time.clock, timing: { artDebounceMillis: 30_000 } })
    const { fake, registry } = engine
    const elena = threadId(fake, 'C0HIRING', 'Rina finished the onsite')

    await step('with AI assist off, Home ranks what waits, where the user left off and what moved, and nothing asks the model', async () => {
      await engine.workPass('title')
      await engine.workPass('art')
      await engine.workPass('home')
      const first = await homeUntil(engine, (view) => view.items.length > 0, 'a waiting item')
      expect(first.items[0]).toMatchObject({ kind: 'waiting', topics: [{ id: elena }] })

      const postgres = threadId(fake, 'C0ENG', 'Draft plan is in the doc')
      valueOf(await runCommand(registry, homeVisit, { id: postgres }))
      burst(engine, postgres)
      const resumed = await homeUntil(engine, (view) => kinds(view).includes('resume'), 'pick up where you left off')
      // The visited topic shows once, under its higher kind.
      expect(resumed.items.filter((item) => item.topics.some((topic) => topic.id === postgres)).map((item) => item.kind)).toEqual(['resume'])

      const staging = threadId(fake, 'C0ENG', 'Unrelated: has anyone looked at the staging bill')
      burst(engine, staging)
      // The item shows from a few replies on, before the last of the nine is stored.
      const moved = await homeUntil(engine, (view) => view.items.some((item) => item.kind === 'moved' && item.newCount === 9), 'moved a lot, all nine stored')
      expect(kinds(moved)).toEqual(['waiting', 'resume', 'moved'])
      expect(moved.items[2]!.id).toBe(`moved:${staging}`)
      expect(moved.items.every((item) => item.aiTitle === undefined)).toBe(true)

      const rows = await engine.rows()
      expect(threads(rows).every((row) => row.titleSource === 'fallback')).toBe(true)
      expect(rows.some(hasArt)).toBe(false)
      expect(calls(engine, 'titleTopic') + calls(engine, 'topicArt')).toBe(0)

      // Read in Slack on another client: Home has room again.
      for (const id of [postgres, staging]) {
        const last = fake.messages('C0ENG').filter((message) => message.thread_ts === tsOf(id)).at(-1)!
        fake.markThreadRead({ channel: 'C0ENG', threadTs: tsOf(id), ts: last.ts })
      }
      await homeUntil(engine, (view) => !kinds(view).includes('resume') && !kinds(view).includes('moved'), 'both threads read')
    })

    let followUpTs = ''
    await step('with AI assist on, titles the sidebar threads without opening them, and Home adds a follow-up until Mark done and settled topics', async () => {
      // The fixture incident went quiet 70 minutes ago; one hour makes it eligible.
      valueOf(await runCommand(registry, tidyUpSet, { patch: { quiet: '1h' } }))
      await setPref(engine, 'aiAssist', true)
      const titled = await engine.rowsUntil(allTitled, 'sidebar threads titled')
      expect(threads(titled).length).toBeGreaterThan(1)
      expect(threads(titled).every((row) => row.titleSensitive === undefined)).toBe(true)
      expect(calls(engine, 'titleTopic')).toBeGreaterThan(0)
      expect(calls(engine, 'titleTopic')).toBeLessThanOrEqual(TITLE_DAILY_BUDGET)

      const view = await homeUntil(engine, (value) => kinds(value).includes('followUp') && value.items[0]!.aiTitle !== undefined, 'the AI items')
      expect(view.items[0]).toMatchObject({ kind: 'waiting', topics: [{ id: elena }] })
      const followUp = view.items.find((item) => item.kind === 'followUp')!
      expect(followUp.topics[0]!.id).toBe(threadId(fake, 'D0SAM', 'Notes from today'))
      followUpTs = followUp.messageTs!
      valueOf(await runCommand(registry, homeMarkDone, { topicId: followUp.topics[0]!.id, messageTs: followUpTs }))
      // Each proposal says why, from its last messages.
      const done = await homeUntil(engine, (value) => !kinds(value).includes('followUp') && kinds(value).includes('tidyUp'), 'the follow-up gone and settled topics')
      const tidy = done.items.find((item) => item.kind === 'tidyUp')!
      expect(tidy.topics.length).toBeGreaterThan(0)
      expect(tidy.topics.every((topic) => topic.settled?.kind === 'thanks')).toBe(true)
    })

    await step('a later link of yours makes a follow-up look done; Mark done and Undo, Not done, and a file proposes it again until Mark done', async () => {
      const root = fake.messages('D0SAM').find((message) => message.text?.startsWith('Notes from today'))!.ts
      const promise = `t:D0SAM:${root}`
      const promiseTs = followUpTs
      // The promise back as it was before Mark done, through the review's own Undo command.
      valueOf(await runCommand(registry, followUpsRestore, { topicId: promise, messageTs: promiseTs, doneAt: null, matchKeptTs: null }))
      await homeUntil(engine, (view) => kinds(view).includes('followUp'), 'the follow-up back')
      const doneCard = (view: HomeView) => view.items.find((item) => item.kind === 'doneFollowUps')
      // The user shares their review in the same thread: the promise leaves Follow-up for the card.
      fake.injectMessage({ channel: 'D0SAM', threadTs: root, user: SELF_ID, text: 'Left my notes on the packet: https://docs.example.com/packet-review' })
      const proposed = doneCard(await homeUntil(engine, (view) => doneCard(view) !== undefined && !kinds(view).includes('followUp'), 'the follow-up that looks done'))!
      expect(proposed.topics.map((topic) => topic.id)).toEqual([promise])
      const match = proposed.topics[0]!
      expect(match.followUp).toMatchObject({ kind: 'link', promiseTs, text: expect.stringContaining('docs.example.com/packet-review') })

      // Mark done takes it off the card; the row's Undo brings it back.
      const undo = await actOnDoneFollowUp(registry, match, 'done')
      await homeUntil(engine, (view) => doneCard(view) === undefined && !kinds(view).includes('followUp'), 'marked done')
      await undoOne(registry, undo!)
      await homeUntil(engine, (view) => doneCard(view) !== undefined, 'the card back after Undo')
      // Not done: the promise is back in Follow-up, and this match is not proposed again.
      await actOnDoneFollowUp(registry, match, 'notDone')
      await homeUntil(engine, (view) => doneCard(view) === undefined && kinds(view).includes('followUp'), 'back in Follow-up')

      // A newer message with a file proposes it again, and Mark done takes it off for good.
      fake.workspace.post({ channel: 'D0SAM', threadTs: root, user: SELF_ID, text: "Here's the full review", files: [{ id: 'F0PACKETREVIEW', name: 'packet-review.pdf', title: 'packet-review.pdf', mimetype: 'application/pdf' }] })
      const again = doneCard(await homeUntil(engine, (view) => doneCard(view) !== undefined, 'proposed again for the file'))!
      expect(again.topics[0]!.followUp).toMatchObject({ kind: 'file' })
      await actOnDoneFollowUp(registry, again.topics[0]!, 'done')
      await homeUntil(engine, (view) => doneCard(view) === undefined && !kinds(view).includes('followUp'), 'done for good')
    })

    let before: ReadonlyArray<TopicRow> = []
    await step('draws every thread and channel Main, keeps the photo on a DM Main without asking, and the header shows the row\'s drawing', async () => {
      await drawAll(engine)
      const activity = await activityUntil(engine, (value) => value.calls.some((call) => call.feature === 'topicArt'), 'art in the activity log')
      const drawn = new Set(activity.calls.filter((call) => call.feature === 'topicArt' && call.outcome === 'ok').map((call) => call.subject.id))
      expect(activity.calls.some((call) => call.feature === 'topicArt' && call.subject.id.startsWith('m:D'))).toBe(false)
      before = await engine.rowsUntil((rows) => rows.every((row) => !drawn.has(row.id) || hasArt(row)), 'every drawing shown')
      const withArt = before.filter(hasArt)
      expect(withArt.length).toBeGreaterThan(3)
      expect(withArt.some((row) => row.kind === 'main')).toBe(true)
      expect(withArt.some((row) => row.kind === 'thread' && row.channel.kind === 'im')).toBe(true)
      for (const row of withArt) {
        const parsed = parseRecipe(row.art!)
        expect(parsed.ok && parsed.recipe.confident, `${row.title}: ${row.art}`).toBe(true)
      }
      const dmMains = before.filter(isDmMain)
      expect(dmMains.length).toBeGreaterThan(0)
      expect(dmMains.some(hasArt)).toBe(false)

      const [first] = withArt
      unmounts.push(registry.mount(topicAtom(first!.id)))
      const header = await waitFor(() => {
        const result = registry.get(topicAtom(first!.id))
        return result._tag === 'Success' && result.value?.art !== undefined ? result.value : undefined
      }, WAIT_MS, 'the header with art')
      expect(header.art).toBe(first!.art)
    })

    await step('Redraw replaces one drawing and leaves every other row as it was, and Undo after a Redraw puts the previous drawing back', async () => {
      const target = before.find((row) => row.kind === 'thread' && hasArt(row))!
      expect(await redrawTopic(registry, target.id, { text: 'Redrawn' })).toBeUndefined()
      const after = await engine.rowsUntil((rows) => rows.some((row) => row.id === target.id && hasArt(row) && row.art !== target.art), 'the redrawn row')
      const redrawn = after.find((row) => row.id === target.id)!
      expect(parseRecipe(redrawn.art!).ok).toBe(true)
      for (const row of before) if (row.id !== target.id) expect(after.find((candidate) => candidate.id === row.id)).toBe(row)

      expect(await runAction(registry, artRedraw, { id: target.id }, { text: 'Redrawn' })).toBe(true)
      await engine.rowsUntil((rows) => rows.some((row) => row.id === target.id && hasArt(row) && row.art !== redrawn.art), 'the row redrawn again')
      expect(await undoLast(registry)).toBe(true)
      before = await engine.rowsUntil((rows) => rows.some((row) => row.id === target.id && row.art === redrawn.art), 'the previous drawing back')
    })

    await step('with AI assist off, every row shows the placeholder and a new thread is not drawn; on again, the drawings come back and the new thread is drawn', async () => {
      await setPref(engine, 'aiAssist', false)
      const off = await engine.rowsUntil((rows) => rows.length > 0 && !rows.some(hasArt), 'every row without art')
      expect(off.length).toBe(before.length)
      const asked = calls(engine, 'topicArt')
      const thread = liveThread(engine, 'Postgres replica lag while AI is off')
      await engine.rowsUntil((rows) => rows.some((row) => row.id === thread), 'the new thread in the sidebar')
      await engine.workPass('art')
      expect(calls(engine, 'topicArt')).toBe(asked)

      await setPref(engine, 'aiAssist', true)
      await engine.rowsUntil((rows) => rows.some((row) => row.id === thread && row.titleSource === 'ai'), 'the new thread titled')
      await drawAll(engine)
      const back = await engine.rowsUntil((rows) => rows.some((row) => row.id === thread && hasArt(row)), 'the new thread drawn')
      for (const row of before) expect(back.find((candidate) => candidate.id === row.id)?.art).toBe(row.art)
    })

    await step('keeps the placeholder for a topic the model cannot draw within the vocabulary, and does not ask about it again', async () => {
      const broken = liveThread(engine, 'Broken drawing ::invalid-art:: for this thread')
      // A title finishes before the first drawing, so the drawing is asked once.
      await engine.rowsUntil((rows) => rows.some((row) => row.id === broken) && allTitled(rows), 'every thread titled')
      const asked = calls(engine, 'topicArt')
      await engine.workPass('art')
      expect(calls(engine, 'topicArt')).toBe(asked + 1)
      const next = liveThread(engine, 'Postgres replica lag after the failed drawing')
      await engine.rowsUntil((rows) => rows.some((row) => row.id === next && row.titleSource === 'ai'), 'the next thread titled')
      await engine.workPass('art')
      const rows = await engine.rowsUntil((later) => later.some((row) => row.id === next && hasArt(row)), 'the next thread drawn')
      expect(calls(engine, 'topicArt')).toBe(asked + 2)
      expect(rows.find((row) => row.id === broken)!.art).toBeUndefined()
    })
  } finally {
    for (const engine of engines.splice(0).toReversed()) await engine.stop()
    await time.close()
  }
})

it('titles cost one call each: a key change asks nothing again, a refusal goes to the fallback model or waits for the thread to change, and the daily budget holds', async () => {
  const engine = await syncedEngine(engines, { aiJobs: true })
  const titleCalls = (id: string, activity: AiActivity) => activity.calls.filter((call) => call.feature === 'titleTopic' && call.subject.id === id)

  await step('a key change does not ask again for a thread that has its title', async () => {
    const titled = await engine.rowsUntil(allTitled, 'sidebar threads titled')
    await engine.workPass('title')
    const asked = calls(engine, 'titleTopic')
    engine.main.host.deliver({ _tag: 'aiKey', key: 'fake-changed-key' })
    await engine.workPass('title')
    expect(calls(engine, 'titleTopic')).toBe(asked)
    const after = await engine.rows()
    for (const row of threads(titled)) expect(after.find((candidate) => candidate.id === row.id)?.title).toBe(row.title)
  })

  await step("takes the fallback model's title when the main model refuses, and logs both calls", async () => {
    const id = liveThread(engine, '::refuse:: Postgres migration plan')
    await engine.rowsUntil((rows) => rows.find((row) => row.id === id)?.titleSource === 'ai', 'the fallback title')
    const activity = await activityUntil(engine, (value) => titleCalls(id, value).length === 2, 'both title calls logged')
    const [answered, refused] = titleCalls(id, activity)
    // Settings › AI activity labels these "Refused by the model’s policy. Sent to the fallback model." and "Answered by the fallback model".
    expect(refused).toMatchObject({ outcome: 'error', kind: 'policy.fallback' })
    expect(answered).toMatchObject({ outcome: 'ok', kind: 'fallback' })
    // The default fallback is from another maker.
    expect(answered!.model).toStartWith('google/')
    expect(refused!.model).not.toStartWith('google/')
  })

  await step('without a fallback, asks a refused title once, not again after a wake, and again once the thread has a new message', async () => {
    await setPref(engine, 'aiModels', { fallback: '' })
    const id = liveThread(engine, '::refuse:: Kya kar rahe hain idhar bhai')
    await activityUntil(engine, (value) => titleCalls(id, value).length > 0, 'the refusal logged')
    await engine.workPass('title')
    const refused = calls(engine, 'titleTopic')
    // A new key, and main's wake (as after a higher daily limit), send nothing again.
    engine.main.host.deliver({ _tag: 'aiKey', key: 'fake-other-key' })
    await engine.workPass('title')
    engine.main.host.deliver({ _tag: 'wake' })
    await engine.workPass('title')
    expect(calls(engine, 'titleTopic')).toBe(refused)
    expect((await engine.rows()).find((row) => row.id === id)?.titleSource).toBe('fallback')
    // AI activity shows it once, as "Refused by the model’s policy. Not retried."
    const logged = titleCalls(id, await activityUntil(engine, () => true, 'AI activity'))
    expect(logged.map((call) => [call.outcome, call.kind, call.repeats])).toEqual([['error', 'policy', 1]])

    engine.fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'Any update?', threadTs: tsOf(id) })
    await engine.rowsUntil((rows) => rows.find((row) => row.id === id)?.preview.text === 'Any update?', 'the new reply')
    await engine.workPass('title')
    expect(calls(engine, 'titleTopic')).toBe(refused + 1)
  })

  await step("once the day's budget is spent, a new thread keeps its first words, blurred in privacy mode, with no call", async () => {
    // Titles made earlier today count against the budget, across a relaunch.
    const next = await restart(engines, engine, () => {
      const db = new DatabaseSync(join(engine.userData, 'workspaces', engine.fake.teamId, 'cache.db'))
      try {
        const insert = db.prepare("INSERT INTO ai_cache (task, key, input_hash, output_json, created_at) VALUES ('titleTopic', ?, 'earlier', '\"A title\"', ?)")
        for (let i = 0; i < TITLE_DAILY_BUDGET; i++) insert.run(`earlier:${i}`, String(Date.now()))
      } finally {
        db.close()
      }
    }, { aiJobs: true })
    const id = liveThread(next, 'Postgres migration after the budget is spent')
    await next.rowsUntil((rows) => rows.some((row) => row.id === id), 'the new thread')
    await next.workPass('title')
    const row = (await next.rows()).find((candidate) => candidate.id === id)!
    expect(row.titleSource).toBe('fallback')
    expect(row.titleSensitive).toBe(true)
    expect(calls(next, 'titleTopic')).toBe(0)
  })
})
