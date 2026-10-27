// Which topic fetch Slack is asked first (architecture 5.1 and 5.5): the user's own open and jump go
// before the pages read ahead of them. Here the search reader has stepped through three long threads,
// whose opens read their later pages, and the user jumps to a reply far into the last one. Slack holds
// every later page; the jump is answered while they are still held, and asked twice it reads once.
import type { FakeSlack } from '@juno/fake-slack'
import { loadMessageAt, messagesAtom, openTopic } from '@juno/state'
import { afterEach, expect, it } from 'bun:test'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { apiCalls, DAY, quiet, valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

/** A thread of 250 replies posted with no events, so the store knows nothing of it and its open reads three pages. */
function longThread(fake: FakeSlack, name: string) {
  const now = fake.now()
  const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: `${name} log`, at: now - 2 * DAY, silent: true })
  const replies = Array.from({ length: 250 }, (_, i) =>
    fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: `${name} step ${i + 1}`, threadTs: root.ts, at: now - 2 * DAY + (i + 1) * 1000, silent: true }))
  return { id: `t:C0ENG:${root.ts}`, root, replies }
}

/** A replies page after an open's first: it carries the cursor its first page gave. */
const laterPage = (method: string, args: Readonly<Record<string, string>>) => method === 'conversations.replies' && args['cursor'] !== undefined

it("a jump far into a thread is answered while the opens' later pages are held", async () => {
  const engine = await syncedEngine(engines)
  const threads = ['Alpha', 'Beta', 'Gamma'].map((name) => longThread(engine.fake, name))
  await quiet(engine)
  engine.fake.gate(laterPage)
  const opens: Array<ReturnType<typeof openTopic>> = []

  await step('each open reads its first page, and its next page waits at Slack', async () => {
    for (const [index, thread] of threads.entries()) {
      opens.push(openTopic(engine.registry, thread.id))
      // The first two opens' later pages wait at Slack; the third's first page is answered.
      await waitFor(() => apiCalls(engine, 'conversations.replies').some((call) => call.args['ts'] === thread.root.ts && call.args['cursor'] === undefined) ? true : undefined, WAIT_MS, `${thread.root.text} first page`)
      if (index < 2) await waitFor(() => (engine.fake.gated().length > index ? true : undefined), WAIT_MS, `${thread.root.text} second page held`)
    }
  })

  const last = threads[2]!
  const target = last.replies[199]!.ts
  await step('the jump, asked twice as the reader does, is answered while every later page is still held, reads its pages once, and its window shows the reply', async () => {
    const asked = apiCalls(engine, 'conversations.replies').length
    let answered = 0
    const jumps = [loadMessageAt(engine.registry, last.id, target), loadMessageAt(engine.registry, last.id, target)].map((jump) => jump.then((exit) => {
      answered += 1
      return exit
    }))
    await waitFor(() => (answered === 2 ? true : undefined), WAIT_MS, 'both jumps answered')
    for (const jump of jumps) expect(valueOf(await jump).outcome).toBe('fetched')
    expect(engine.fake.gated().filter((call) => call.stage === 'before').length).toBeGreaterThanOrEqual(2)
    // The page up to the reply and the page from it, once.
    expect(apiCalls(engine, 'conversations.replies').slice(asked).filter((call) => call.args['ts'] === last.root.ts)).toHaveLength(2)
    const atom = messagesAtom(last.id, { anchor: target, before: 50, limit: 150 })
    unmounts.push(engine.registry.mount(atom))
    await waitFor(() => {
      const result = engine.registry.get(atom)
      return result._tag === 'Success' && result.value.order.includes(target) ? true : undefined
    }, WAIT_MS, 'the jump window')
  })

  await step('once Slack answers the pages, every open finishes', async () => {
    engine.fake.gate()
    for (const open of opens) expect(valueOf(await open).outcome).toBe('fetched')
  })
})
