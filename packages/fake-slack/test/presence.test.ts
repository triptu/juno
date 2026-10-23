import { afterAll, beforeAll, expect, it } from 'vitest'
import { AUTO_AWAY_MILLIS, SELF_ID, startFakeSlack, type FakeSlack } from '../src/index.ts'
import type { RtmFrame } from '@juno/slack-schema'
import { isType, TestClient } from './helpers.ts'

let fake: FakeSlack
let client: TestClient

beforeAll(async () => {
  fake = await startFakeSlack()
  client = new TestClient(fake)
})

afterAll(async () => {
  await fake.close()
})

/** `presence.set` with a raw value, past the schema that would refuse it on the way out. */
const setPresenceRaw = async (presence: string) => {
  const form = new FormData()
  form.set('token', client.credentials.token)
  form.set('presence', presence)
  const response = await fetch(`${fake.url}/api/presence.set`, { method: 'POST', body: form, headers: { cookie: `d=${client.credentials.cookie}` } })
  return (await response.json()) as { ok: boolean; error?: string }
}

it('takes only the values the official client sends, and reports them back at boot and on the socket', async () => {
  // `auto` is the public users.setPresence value; presence.set refuses it.
  expect(await setPresenceRaw('auto')).toEqual({ ok: false, error: 'invalid_presence' })
  expect((await client.ok('client.userBoot', {})).self.manual_presence).toBe('active')

  const socket = await client.connect()
  await socket.next(isType('hello'))
  expect(await setPresenceRaw('away')).toEqual({ ok: true })
  expect(await socket.next(isType('manual_presence_change'))).toMatchObject({ presence: 'away' })
  expect((await client.ok('client.userBoot', {})).self.manual_presence).toBe('away')
  socket.close()
})

it("answers presence_sub with each person's presence, sends their changes, and an empty presence_sub ends the subscription", async () => {
  const socket = await client.connect()
  await socket.next(isType('hello'))
  fake.setPresence({ users: ['U0MAYA'], presence: 'active' })
  socket.send({ type: 'presence_sub', ids: ['U0MAYA', 'U0LEO'] })
  expect(await socket.next(isType('presence_change'))).toMatchObject({ presence: 'active', users: ['U0MAYA'] })
  expect(await socket.next(isType('presence_change'))).toMatchObject({ presence: 'away', users: ['U0LEO'] })
  fake.setPresence({ users: ['U0LEO', 'U0PRIYA'], presence: 'active' })
  expect(await socket.next(isType('presence_change'))).toMatchObject({ presence: 'active', users: ['U0LEO'] })

  socket.send({ type: 'presence_sub', ids: [] })
  await expect.poll(() => fake.presenceSubscriptions()).toEqual([])
  fake.setPresence({ users: ['U0MAYA'], presence: 'away' })
  socket.send({ type: 'ping', id: 16385 })
  // The pong comes next: no presence_change went out before it.
  expect(await socket.next((frame) => frame.type === 'pong' || frame.type === 'presence_change')).toMatchObject({ type: 'pong' })
  fake.setPresence({ users: ['U0LEO', 'U0PRIYA'], presence: 'away' })
  socket.close()
})

it('tells a socket subscribed to the self user when what colleagues see for them changes', async () => {
  expect(await setPresenceRaw('active')).toEqual({ ok: true })
  const socket = await client.connect()
  await socket.next(isType('hello'))
  const self = (frame: RtmFrame) => frame.type === 'presence_change' && frame.users?.includes(SELF_ID) === true
  socket.send({ type: 'presence_sub', ids: [SELF_ID] })
  // No tickle yet: away, even though manual presence is active.
  expect(await socket.next(self)).toMatchObject({ presence: 'away', users: [SELF_ID] })
  socket.send({ type: 'tickle', reason: 'polling' })
  expect(await socket.next(self)).toMatchObject({ presence: 'active' })
  fake.advanceClock({ millis: AUTO_AWAY_MILLIS + 1_000 })
  expect(await socket.next(self)).toMatchObject({ presence: 'away' })
  socket.send({ type: 'tickle', reason: 'polling' })
  expect(await socket.next(self)).toMatchObject({ presence: 'active' })
  expect(await setPresenceRaw('away')).toEqual({ ok: true })
  expect(await socket.next(self)).toMatchObject({ presence: 'away' })
  socket.close()
})
