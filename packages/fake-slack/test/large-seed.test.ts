import { describe, expect, it } from 'vitest'
import { LARGE_SEED_DEFAULTS, largeSeed, startFakeSlack } from '../src/index.ts'
import { TestClient } from './helpers.ts'

/** A fraction of the perf seed: the generator's shape is the same, the test stays quick. */
const SMALL = { users: 100, channels: { public: 18, private: 6, dms: 4, mpims: 2 }, topics: 150, messages: 2_000 } as const

describe('the large seed', () => {
  it('generates the perf workspace deterministically', async () => {
    const fake = await startFakeSlack({ seed: largeSeed(SMALL) })
    try {
      expect(fake.workspace.users.size).toBe(SMALL.users)
      expect(fake.workspace.conversations.size).toBe(30)
      let messages = 0
      let threads = 0
      for (const id of fake.workspace.conversations.keys()) {
        const all = fake.messages(id)
        messages += all.length
        threads += all.filter((m) => (m.reply_count ?? 0) > 0).length
      }
      expect(messages).toBe(SMALL.messages)
      expect(threads).toBeGreaterThan(SMALL.topics * 0.8)
      expect(threads).toBeLessThanOrEqual(SMALL.topics)

      // Everything decodes through the schemas, like the default fixture.
      const client = new TestClient(fake)
      const boot = await client.ok('client.userBoot', {})
      expect(boot.channels.length + boot.ims.length).toBe(30)
      const view = await client.ok('subscriptions.thread.getView', { limit: 50 })
      expect(view.threads).toHaveLength(10)
      expect(view.has_more).toBe(true)
      const first = [...fake.workspace.conversations.keys()][0]!
      const history = await client.ok('conversations.history', { channel: first, limit: 100, ignore_replies: true })
      expect(history.messages.length).toBeGreaterThan(0)

      // The same seed gives the same workspace.
      const again = await startFakeSlack({ seed: largeSeed(SMALL) })
      try {
        expect(again.messages(first).map((m) => m.text)).toEqual(fake.messages(first).map((m) => m.text))
      } finally {
        await again.close()
      }
    } finally {
      await fake.close()
    }
  }, 30_000)

  it('keeps the documented defaults', () => {
    expect(LARGE_SEED_DEFAULTS).toMatchObject({ channels: { public: 180, private: 60, dms: 40, mpims: 20 }, topics: 5_000, messages: 100_000 })
  })
})
