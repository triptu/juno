import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compareTs, searchMatches, type Message, type Ts } from '@juno/slack-schema'
import { startFakeSlack, type FakeSlack } from '../src/index.ts'
import { TestClient } from './helpers.ts'

let fake: FakeSlack
let client: TestClient

beforeAll(async () => {
  fake = await startFakeSlack()
  client = new TestClient(fake)
})

afterAll(async () => {
  await fake.close()
})

function assertDescending(messages: ReadonlyArray<Message>): void {
  for (let i = 1; i < messages.length; i++) expect(compareTs(messages[i - 1]!.ts, messages[i]!.ts)).toBe(1)
}

describe('pagination', () => {
  it('history pages by cursor, newest first, without gaps or duplicates', async () => {
    const all = await client.ok('conversations.history', { channel: 'C0ENG', limit: 100, ignore_replies: true })
    expect(all.has_more).toBe(false)
    expect(all.messages.length).toBeGreaterThan(6)
    assertDescending(all.messages)

    const seen: Message[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const page = await client.ok('conversations.history', { channel: 'C0ENG', limit: 3, ignore_replies: true, ...(cursor === undefined ? {} : { cursor }) })
      pages += 1
      expect(page.messages.length).toBeLessThanOrEqual(3)
      seen.push(...page.messages)
      cursor = page.has_more ? page.response_metadata?.next_cursor : undefined
      if (page.has_more) expect(cursor).toBeTruthy()
      else expect(page.response_metadata?.next_cursor ?? '').toBe('')
    } while (cursor !== undefined)
    expect(pages).toBe(Math.ceil(all.messages.length / 3))
    expect(seen.map((m) => m.ts)).toEqual(all.messages.map((m) => m.ts))
  })

  it('history honours oldest, latest and inclusive', async () => {
    const all = await client.ok('conversations.history', { channel: 'C0ENG', limit: 100, ignore_replies: true })
    const [newest, second, third] = all.messages
    const exclusive = await client.ok('conversations.history', { channel: 'C0ENG', oldest: third!.ts, latest: newest!.ts, inclusive: false })
    expect(exclusive.messages.map((m) => m.ts)).toEqual([second!.ts])
    const inclusive = await client.ok('conversations.history', { channel: 'C0ENG', oldest: third!.ts, latest: newest!.ts, inclusive: true })
    expect(inclusive.messages.map((m) => m.ts)).toEqual([newest!.ts, second!.ts, third!.ts])
    const since = await client.ok('conversations.history', { channel: 'C0ENG', oldest: second!.ts, inclusive: false })
    expect(since.messages.map((m) => m.ts)).toEqual([newest!.ts])
  })

  it('replies page oldest first starting at the root', async () => {
    const history = await client.ok('conversations.history', { channel: 'C0ENG', limit: 100, ignore_replies: true })
    const root = history.messages.find((m) => (m.reply_count ?? 0) >= 6)!
    const first = await client.ok('conversations.replies', { channel: 'C0ENG', ts: root.ts, limit: 3 })
    expect(first.messages[0]?.ts).toBe(root.ts)
    expect(first.messages).toHaveLength(3)
    expect(first.has_more).toBe(true)
    const second = await client.ok('conversations.replies', { channel: 'C0ENG', ts: root.ts, limit: 3, cursor: first.response_metadata!.next_cursor! })
    expect(compareTs(second.messages[0]!.ts, first.messages[2]!.ts)).toBe(1)
    const third = await client.ok('conversations.replies', { channel: 'C0ENG', ts: root.ts, limit: 3, cursor: second.response_metadata!.next_cursor! })
    expect(third.has_more).toBe(false)
    const total = first.messages.length + second.messages.length + third.messages.length
    expect(total).toBe((root.reply_count ?? 0) + 1)
    // The latest two replies only, as the preview fetch does.
    const tail = await client.ok('conversations.replies', { channel: 'C0ENG', ts: root.ts, oldest: root.latest_reply!, inclusive: true, limit: 2 })
    expect(tail.messages.map((m) => m.ts)).toEqual([root.latest_reply])
  })

  it('thread view pages by current_ts', async () => {
    const all = await client.ok('subscriptions.thread.getView', { limit: 100 })
    const latest = (t: (typeof all.threads)[number]) => t.root_msg.latest_reply!
    for (let i = 1; i < all.threads.length; i++) expect(compareTs(latest(all.threads[i - 1]!), latest(all.threads[i]!))).toBe(1)
    const seen: string[] = []
    let current: Ts | undefined
    for (;;) {
      const page = await client.ok('subscriptions.thread.getView', { limit: 2, ...(current === undefined ? {} : { current_ts: current }) })
      seen.push(...page.threads.map((t) => t.root_msg.ts))
      if (!page.has_more) break
      current = latest(page.threads.at(-1)!)
    }
    expect(seen).toEqual(all.threads.map((t) => t.root_msg.ts))
  })

  it('search pages by page number and by cursor', async () => {
    const first = await client.ok('search.modules.messages', { module: 'messages', query: 'is:thread', count: 5, page: 1 })
    expect(searchMatches(first)).toHaveLength(5)
    expect(first.pagination?.page_count).toBeGreaterThan(1)
    const second = await client.ok('search.modules.messages', { module: 'messages', query: 'is:thread', count: 5, page: 2 })
    expect(searchMatches(second)[0]?.ts).not.toBe(searchMatches(first)[0]?.ts)
    const byCursor = await client.ok('search.modules.messages', { module: 'messages', query: 'is:thread', count: 5, cursor: first.response_metadata!.next_cursor! })
    expect(searchMatches(byCursor).map((m) => m.ts)).toEqual(searchMatches(second).map((m) => m.ts))
    const today = new Date(fake.now()).toISOString().slice(0, 10)
    const recent = await client.ok('search.modules.messages', { module: 'messages', query: `is:thread after:${today}`, count: 50 })
    expect(searchMatches(recent)).toHaveLength(0)
  })
})
