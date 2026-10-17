// Activity's run log (SPEC 13.9): what started each run, what it read, the steps it took and what
// they returned, and its model and cost, on the real turn engine with the scripted fake provider.
import { Schema } from 'effect'
import { afterEach, expect, it } from 'vitest'
import { reply } from '@juno/agent-testing'
import { HostMessagePage } from '@juno/agent-contract'
import { activityPage } from '../src/serve/pages'
import { fakeHost, say, turnsHarness } from './turns-harness'
import { seedRuns } from './activity-seed'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
})

let calls = 0
const call = (name: string, args: Record<string, unknown>) => reply({ type: 'toolCall', id: `call-${name}-${++calls}`, name, arguments: args as never })

/** Two placeholder messages in one channel, as the host returns them. */
const page = Schema.decodeUnknownSync(HostMessagePage)({
  messages: [1, 2].map((n) => ({ channelId: 'C_ENG', channelName: '#eng', ts: `1760400000.00010${n}`, senderId: 'U1', text: `placeholder ${n}` })),
})

async function open() {
  const reads = fakeHost()
  const h = await turnsHarness({ host: { ...reads.host, history: async () => page, search: async () => ({ messages: [] }) } })
  cleanups.push(h.close)
  return h
}

it('a run names its message, the channel it read, each step with its result, and its model and cost', async () => {
  const h = await open()
  h.fake.script([call('slack_history', { channel: 'C_ENG' }), call('slack_search', { query: 'launch date' }), reply(say('Two updates.'))])
  await h.ended(h.send('what changed in eng today?'))
  h.fake.script([reply(say('Hi.'))])
  await h.ended(h.send('thanks'))

  const { runs, moreAbove } = activityPage(h.turns.store, { limit: 50 })
  expect(moreAbove).toBe(false)
  // Newest first.
  expect(runs.map((run) => run.trigger)).toEqual([
    { _tag: 'message', words: 'thanks', files: 0 },
    { _tag: 'message', words: 'what changed in eng today?', files: 0 },
  ])
  const [quiet, read] = runs
  expect(quiet).toMatchObject({ outcome: 'replied', sources: [], steps: [], tainted: false })
  expect(read).toMatchObject({ outcome: 'replied', sources: ['#eng'], tainted: true })
  expect(read!.steps).toEqual([
    { label: 'Read #eng', result: '2 messages', outcome: 'done' },
    { label: 'Searched Slack', input: 'launch date', result: '0 messages', outcome: 'done' },
  ])
  // Its three requests are counted against its model, at the guard's prices.
  expect(read!.model).toBeTruthy()
  expect(read!.costUsd).toBeGreaterThan(0)
  expect(h.turns.store.db.prepare('SELECT requests FROM run_usage WHERE run_id = ?').get(read!.id)).toEqual({ requests: 3 })
})

it('a read never keeps what it returned, only how many messages', async () => {
  const h = await open()
  h.fake.script([call('slack_history', { channel: 'C_ENG' }), reply(say('Done.'))])
  await h.ended(h.send('read eng'))
  const details = h.turns.store.db.prepare('SELECT detail FROM run_steps').all() as Array<{ detail: string }>
  expect(details).toEqual([{ detail: '2 messages' }])
  expect(JSON.stringify(activityPage(h.turns.store, { limit: 50 }))).not.toContain('placeholder')
})

it('a window is the newest runs, and the cursor pages back from the oldest shown', async () => {
  const h = await open()
  h.fake.script([1, 2, 3].map((n) => reply(say(`Answer ${n}.`))))
  for (const n of [1, 2, 3]) await h.ended(h.send(`message ${n}`))
  const newest = activityPage(h.turns.store, { limit: 2 })
  expect(newest.runs.map((run) => run.trigger)).toMatchObject([{ words: 'message 3' }, { words: 'message 2' }])
  expect(newest.moreAbove).toBe(true)
  const older = activityPage(h.turns.store, { limit: 2, cursor: newest.runs[1]!.id })
  expect(older.runs.map((run) => run.trigger)).toMatchObject([{ words: 'message 1' }])
  expect(older.moreAbove).toBe(false)
})

it('removing a message clears its run\'s words and step arguments, and later runs keep theirs', async () => {
  const h = await open()
  h.fake.script([call('slack_search', { query: 'offsite plans' }), reply(say('Found it.'))])
  const first = h.send('find the offsite plans')
  await h.ended(first)
  h.fake.script([call('slack_search', { query: 'hiring' }), reply(say('Nothing.'))])
  await h.ended(h.send('and hiring?'))
  const id = (h.turns.store.db.prepare("SELECT min(id) AS id FROM messages WHERE kind = 'user' AND origin_op = ?").get(first) as { id: number }).id
  await h.turns.redaction.remove({ opId: 'remove-1', messageIds: [id], alsoRemoveReply: false })
  const [later, removed] = activityPage(h.turns.store, { limit: 50 }).runs
  expect(removed!.trigger).toEqual({ _tag: 'message', words: '', files: 0 })
  expect(removed!.steps).toEqual([{ label: 'Searched Slack', outcome: 'done' }])
  expect(later!.steps).toEqual([{ label: 'Searched Slack', input: 'hiring', result: '0 messages', outcome: 'done' }])
})

it('500 runs: a window is read with the index and stays a small payload', async () => {
  const h = await open()
  const { db } = h.turns.store
  seedRuns(db, 500)

  const plan = (db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM runs WHERE ended_at IS NOT NULL AND (? IS NULL OR (started_at, id) < (?, ?)) ORDER BY started_at DESC, id DESC LIMIT ?`).all(null, 0, '', 51) as Array<{ detail: string }>).map((row) => row.detail)
  expect(plan.join('\n')).toContain('runs_by_start')
  expect(plan.join('\n')).not.toMatch(/SCAN runs(?! USING)/)

  const first = activityPage(h.turns.store, { limit: 50 })
  expect(first.runs).toHaveLength(50)
  expect(first.runs[0]!.trigger).toMatchObject({ words: 'question 499 about the rollout plan and who reviews it' })
  // Its time against the switch budget is checked alone, in activity.bench.test.ts.
  // A snapshot stays under 200 KB even at the page's largest window (performance rule 16).
  expect(JSON.stringify(activityPage(h.turns.store, { limit: 200 })).length).toBeLessThan(200_000)
})
