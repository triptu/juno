import { afterEach, expect, it } from 'vitest'
import { compareTs } from '@juno/slack-schema'
import { startFakeSlack, type FakeSlack } from '../src/index.ts'
import { TestClient } from './helpers.ts'

const fakes: FakeSlack[] = []
afterEach(async () => { for (const fake of fakes.splice(0)) await fake.close() })

it('returns unchanged ids, changed bodies and deletions with independent mutation markers', async () => {
  const fake = await startFakeSlack()
  fakes.push(fake)
  const client = new TestClient(fake)
  const channel = 'C0ENG'
  const root = fake.injectMessage({ channel, text: 'Conditional root.' })
  const edited = fake.injectMessage({ channel, threadTs: root.ts, text: 'Original.' })
  const deleted = fake.injectMessage({ channel, threadTs: root.ts, text: 'Remove this.' })
  const reacted = fake.injectMessage({ channel, threadTs: root.ts, text: 'Reaction here.' })
  fake.addReaction({ channel, ts: reacted.ts, name: 'eyes' })
  const before = await client.ok('conversations.replies', { channel, ts: root.ts, cached_latest_updates: {} })
  const counts = await client.ok('client.counts', {})
  fake.editMessage({ channel, ts: edited.ts, text: 'Changed.' })
  fake.deleteMessage({ channel, ts: deleted.ts })
  fake.removeReaction({ channel, ts: reacted.ts, name: 'eyes' })
  const after = await client.ok('conversations.replies', { channel, ts: root.ts, cached_latest_updates: before.latest_updates ?? {} })
  expect(after.messages.find((m) => m.ts === edited.ts)?.text).toBe('Changed.')
  expect(after.messages.find((m) => m.ts === reacted.ts)?.reactions ?? []).toEqual([])
  expect(after.deleted).toEqual([])
  expect(after.messages.some((m) => m.ts === deleted.ts)).toBe(false)
  const nextCounts = await client.ok('client.counts', {})
  const previous = counts.channels.find((c) => c.id === channel)!
  const next = nextCounts.channels.find((c) => c.id === channel)!
  expect(next.latest).toBe(previous.latest)
  expect(compareTs(next.updated!, previous.updated!)).toBe(1)
  expect(compareTs(next.history_invalid!, previous.history_invalid!)).toBe(1)
  const versions = { ...before.latest_updates, ...after.latest_updates }
  const unchanged = await client.ok('conversations.replies', { channel, ts: root.ts, cached_latest_updates: versions, limit: 2 })
  expect(unchanged.messages).toEqual([])
  expect(unchanged.unchanged_messages).toHaveLength(2)
  expect(unchanged.has_more).toBe(true)
  const rest = await client.ok('conversations.replies', {
    channel, ts: root.ts, cached_latest_updates: versions, limit: 2, cursor: unchanged.response_metadata?.next_cursor ?? '',
  })
  expect(rest.messages).toEqual([])
  expect(rest.unchanged_messages).toContain(reacted.ts)
  expect(rest.has_more).toBe(false)
})

it('keeps updated fixed for a new Main message and returns changed markers in incremental counts', async () => {
  const fake = await startFakeSlack()
  fakes.push(fake)
  const client = new TestClient(fake)
  const channel = 'C0ENG'
  const before = await client.ok('client.counts', {})
  const marker = before.channels.find((c) => c.id === channel)!.updated
  fake.advanceClock({ millis: 2_000 })
  const root = fake.injectMessage({ channel, text: 'New Main message.' })
  const posted = await client.ok('client.counts', { counts_last_fetched: before.counts_last_fetched! })
  expect(posted.channels.find((c) => c.id === channel)).toMatchObject({ latest: root.ts, updated: marker })
  fake.advanceClock({ millis: 2_000 })
  fake.injectMessage({ channel, threadTs: root.ts, text: 'Reply changes the root.' })
  const replied = await client.ok('client.counts', { counts_last_fetched: posted.counts_last_fetched! })
  const changed = replied.channels.find((c) => c.id === channel)!
  expect(changed.updated).not.toBe(marker)
  expect(changed.history_invalid).toBe(before.channels.find((c) => c.id === channel)!.history_invalid)
})
