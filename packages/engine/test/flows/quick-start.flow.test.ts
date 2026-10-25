// The preview search after the quick start (architecture 5.8, "Sync", step 4; `searchPreviews` in
// `@juno/sync` discovery): the busiest channels show a preview seconds after sign-in, before their history
// is read. A cold boot on a fresh fake, since the first sync is what it tests.
import { afterEach, expect, it } from 'bun:test'
import type { TopicRow } from '@juno/contract'
import { startTestEngine, type RunningEngine } from '../harness'
import { apiCalls } from '../scenario'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

it('the busiest channels preview their newest message from the preview search while their history waits', async () => {
  // Every history page waits, so a channel's newest message can only come from the search.
  const engine = await startTestEngine({ initial: (fake) => {
    fake.holdNext({ method: 'conversations.history', times: 1_000, before: true, reason: 'history' })
    return fake.signIn()
  } })
  engines.push(engine)
  await engine.status('ready')
  // Before it, a channel's Main shows the root of a followed thread from getView at most; the search brings its newest message.
  const preview = (rows: ReadonlyArray<TopicRow>, id: string) => rows.find((row) => row.id === id)?.preview
  const rows = await engine.rowsUntil((list) => preview(list, 'm:C0ENG')?.sender === 'Dev' && preview(list, 'm:C0PLATFORM')?.sender === 'Jonas', 'the newest messages as previews')
  expect([preview(rows, 'm:C0ENG'), preview(rows, 'm:C0PLATFORM')]).toEqual([
    { sender: 'Dev', text: '@Leo I think the preview environments never shut down. Will check.' },
    { sender: 'Jonas', text: "We have 142 flags. 61 haven't changed in 90 days." },
  ])
  expect(apiCalls(engine, 'conversations.history')).toHaveLength(0)
  expect(engine.fake.heldCount({ method: 'conversations.history' })).toBe(1)
  engine.fake.release({ method: 'conversations.history' })
  await engine.phase('live')
})
