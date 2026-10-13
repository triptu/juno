import { describe, expect, it } from 'vitest'
import { LARGE_SEED_DEFAULTS, largeSeed, startFakeSlack } from '../src/index.ts'
import { TestClient } from './helpers.ts'

describe('the large seed', () => {
  it('generates the perf workspace in a few seconds, deterministically', async () => {
    const started = Date.now()
    const fake = await startFakeSlack({ seed: largeSeed() })
    try {
      const elapsed = Date.now() - started
      expect(elapsed).toBeLessThan(20_000)
      expect(fake.workspace.users.size).toBe(LARGE_SEED_DEFAULTS.users)
      expect(fake.workspace.conversations.size).toBe(300)
      let messages = 0
      let threads = 0
      for (const id of fake.workspace.conversations.keys()) {
        const all = fake.messages(id)
        messages += all.length
        threads += all.filter((m) => (m.reply_count ?? 0) > 0).length
      }
      expect(messages).toBe(LARGE_SEED_DEFAULTS.messages)
      expect(threads).toBeGreaterThan(4_000)
      expect(threads).toBeLessThanOrEqual(LARGE_SEED_DEFAULTS.topics)

      // Everything decodes through the schemas, like the default fixture.
      const client = new TestClient(fake)
      const boot = await client.ok('client.userBoot', {})
      expect(boot.channels.length + boot.ims.length).toBe(300)
      const view = await client.ok('subscriptions.thread.getView', { limit: 50 })
      expect(view.threads).toHaveLength(50)
      const first = [...fake.workspace.conversations.keys()][0]!
      const history = await client.ok('conversations.history', { channel: first, limit: 100, ignore_replies: true })
      expect(history.messages.length).toBeGreaterThan(0)

      // The same seed gives the same workspace.
      const again = await startFakeSlack({ seed: largeSeed() })
      try {
        expect(again.messages(first).map((m) => m.text)).toEqual(fake.messages(first).map((m) => m.text))
      } finally {
        await again.close()
      }
    } finally {
      await fake.close()
    }
  }, 60_000)
})
