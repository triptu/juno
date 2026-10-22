// Who reacted, as Slack lists it: pages and `reactions.get` cut a reaction's
// people at `REACTORS_LISTED` with the count exact; `full` lists everyone.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Ts } from '@juno/slack-schema'
import { REACTORS_LISTED, startFakeSlack, type FakeSlack } from '../src/index.ts'
import { TestClient } from './helpers.ts'

let fake: FakeSlack
let client: TestClient

beforeEach(async () => {
  fake = await startFakeSlack({ now: Date.UTC(2026, 9, 12, 9, 0, 0) })
  client = new TestClient(fake)
})

afterEach(async () => {
  await fake.close()
})

describe('reactors', () => {
  it('seeds 40 people on one emoji and 12 emoji, custom ones included', () => {
    const seed = fake.seedManyReactions()
    expect(seed.reactions).toHaveLength(12)
    expect(seed.reactions[0]).toMatchObject({ name: '+1' })
    expect(seed.reactions[0]!.users).toHaveLength(40)
    expect(seed.reactions[0]!.users).toContain(fake.selfId)
    for (const name of ['juno_party', 'juno_shipit', 'juno_coffee', 'hello_juno']) expect(seed.reactions.map((r) => r.name)).toContain(name)
    for (const name of Object.values(seed.names)) expect(name.length).toBeGreaterThan(18)
  })

  it('cuts the people of a page and of reactions.get, and lists everyone with full', async () => {
    const seed = fake.seedManyReactions()
    const page = await client.ok('conversations.history', { channel: seed.channel, limit: 5 })
    const listed = page.messages.find((m) => m.ts === seed.ts)?.reactions?.find((r) => r.name === '+1')
    expect(listed).toMatchObject({ count: 40 })
    expect(listed?.users).toEqual(seed.reactions[0]!.users.slice(0, REACTORS_LISTED))

    const cut = await client.ok('reactions.get', { channel: seed.channel, timestamp: Ts.make(seed.ts) })
    expect(cut.message?.reactions?.find((r) => r.name === '+1')?.users).toHaveLength(REACTORS_LISTED)
    const full = await client.ok('reactions.get', { channel: seed.channel, timestamp: Ts.make(seed.ts), full: true })
    expect(full.message?.reactions?.map((r) => [r.name, r.users?.length, r.count])).toEqual(seed.reactions.map((r) => [r.name, r.users.length, r.users.length]))
  })

  it('answers message_not_found for a ts no message has', async () => {
    const answer = await client.call('reactions.get', { channel: 'C0ENG', timestamp: Ts.make('1000000000.000100'), full: true })
    expect(answer.body).toEqual({ ok: false, error: 'message_not_found' })
  })
})
