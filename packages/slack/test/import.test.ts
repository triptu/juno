// The Slack-app import seam: a fixture directory written by the fake stands
// in for the real app's data, and an injected password for the keychain.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeSlackAppFixture } from '@juno/fake-slack'
import { readSlackAppSession, SlackAppImportError, snappyUncompress } from '../src/import/index.ts'

const dirs: Array<string> = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function fixture(options: Parameters<typeof writeSlackAppFixture>[1]) {
  const dir = await mkdtemp(join(tmpdir(), 'juno-slack-app-'))
  dirs.push(dir)
  await writeSlackAppFixture(dir, options)
  return dir
}

const team = {
  id: 'T0JUNO',
  name: 'Juno Fake',
  domain: 'juno-fake',
  url: 'https://juno-fake.slack.com/',
  token: 'xoxc-fresh-000000000000',
  userId: 'U0ALEX',
}

describe('readSlackAppSession', () => {
  it('takes the newest localConfig_v2 across the log and the table and decrypts the d cookie for the team host', async () => {
    const dir = await fixture({ team, cookie: 'fixture-d-cookie', keychainPassword: 'test-password' })
    const session = await readSlackAppSession({ dir, keychainPassword: 'test-password' })
    expect(session.team.id).toBe('T0JUNO')
    expect(session.team.token).toBe('xoxc-fresh-000000000000')
    expect(session.team.user_id).toBe('U0ALEX')
    expect(session.cookie).toMatchObject({ name: 'd', value: 'fixture-d-cookie', host: '.slack.com', secure: true, httpOnly: true })
    expect(session.cookie.expires).toBeGreaterThan(Date.now() / 1000)
  })

  it('keeps the enterprise id of a Grid team', async () => {
    const dir = await fixture({ team: { ...team, enterpriseId: 'E0ORG' }, cookie: 'c', keychainPassword: 'p' })
    const session = await readSlackAppSession({ dir, keychainPassword: 'p' })
    expect(session.team.enterprise_id).toBe('E0ORG')
  })

  it('works for a workspace on a plain host, as the fake is', async () => {
    const dir = await fixture({ team: { ...team, url: 'http://127.0.0.1:4321/' }, cookie: 'fake-d', keychainPassword: 'p' })
    const session = await readSlackAppSession({ dir, keychainPassword: 'p' })
    expect(session.cookie).toMatchObject({ value: 'fake-d', host: '127.0.0.1', secure: false })
  })

  it('finds no cookie with the wrong password instead of garbage', async () => {
    const dir = await fixture({ team, cookie: 'c', keychainPassword: 'right' })
    await expect(readSlackAppSession({ dir, keychainPassword: 'wrong' })).rejects.toMatchObject(
      new SlackAppImportError('no-cookie'),
    )
  })

  it('reports a missing team record', async () => {
    const dir = await fixture({ team: { ...team, token: 'not-a-token' }, cookie: 'c', keychainPassword: 'p', staleTeam: { ...team, token: 'xoxp-nope' } })
    await expect(readSlackAppSession({ dir, keychainPassword: 'p' })).rejects.toMatchObject(new SlackAppImportError('no-team'))
  })
})

describe('snappyUncompress', () => {
  it('handles literals and overlapping copies', () => {
    // length 8; literal "abcd"; copy of 4 bytes from offset 4.
    const stream = Uint8Array.from([0x08, 0x0c, 0x61, 0x62, 0x63, 0x64, 0x01, 0x04])
    expect(Buffer.from(snappyUncompress(stream)).toString()).toBe('abcdabcd')
    // length 5; literal "a"; copy of 4 bytes from offset 1 (a run).
    const run = Uint8Array.from([0x05, 0x00, 0x61, 0x01, 0x01])
    expect(Buffer.from(snappyUncompress(run)).toString()).toBe('aaaaa')
  })
})
