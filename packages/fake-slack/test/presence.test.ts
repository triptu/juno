import { afterAll, beforeAll, expect, it } from 'vitest'
import { startFakeSlack, type FakeSlack } from '../src/index.ts'
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
