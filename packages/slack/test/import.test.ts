// The Slack-app import seam: a fixture directory written by the fake stands
// in for the real app's data, and an injected password for the keychain.
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeSlackAppFixture } from '@juno/fake-slack'
import {
  locateSlackAppData,
  readSlackAppSession,
  slackAppCandidates,
  SlackAppImportError,
  snappyUncompress,
} from '../src/import/index.ts'

const dirs: Array<string> = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'juno-slack-app-'))
  dirs.push(dir)
  return dir
}

async function fixture(options: Parameters<typeof writeSlackAppFixture>[1], dir?: string) {
  const target = dir ?? (await tempDir())
  await writeSlackAppFixture(target, options)
  return target
}

/** Sets a whole fixture tree's files to one modification time, in seconds. */
async function touch(dir: string, seconds: number) {
  for (const path of [join(dir, 'Local Storage', 'leveldb'), join(dir, 'Cookies'), join(dir, 'Network', 'Cookies')]) {
    await utimes(path, seconds, seconds).catch(() => {})
  }
}

const team = {
  id: 'T0JUNO',
  name: 'Juno Fake',
  domain: 'juno-fake',
  url: 'https://juno-fake.slack.com/',
  token: 'xoxc-fresh-000000000000',
  userId: 'U0TUSHAR',
}

describe('readSlackAppSession', () => {
  it('takes the newest localConfig_v2 across the log and the table and decrypts the d cookie for the team host', async () => {
    const dir = await fixture({ team, cookie: 'fixture-d-cookie', keychainPassword: 'test-password' })
    const session = await readSlackAppSession({ dir, keychainPassword: 'test-password' })
    expect(session.team.id).toBe('T0JUNO')
    expect(session.team.token).toBe('xoxc-fresh-000000000000')
    expect(session.team.user_id).toBe('U0TUSHAR')
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

  it('reads the cookie store at Network/Cookies, as newer Chromium writes it', async () => {
    const dir = await fixture({ team, cookie: 'network-d', keychainPassword: 'p', cookiesFile: 'Network/Cookies' })
    const session = await readSlackAppSession({ dir, keychainPassword: 'p' })
    expect(session.cookie.value).toBe('network-d')
  })

  it('reports a signed-out app without asking for the keychain', async () => {
    const dir = await fixture({ team, cookie: 'c', keychainPassword: 'p', signedOut: true })
    let asked = false
    const keychainPassword = async () => {
      asked = true
      return 'p'
    }
    await expect(readSlackAppSession({ dir, keychainPassword })).rejects.toMatchObject(new SlackAppImportError('signed-out'))
    expect(asked).toBe(false)
  })

  it('reports a declined keychain prompt', async () => {
    const dir = await fixture({ team, cookie: 'c', keychainPassword: 'p' })
    await expect(readSlackAppSession({ dir, keychainPassword: async () => undefined })).rejects.toMatchObject(
      new SlackAppImportError('no-keychain'),
    )
  })

  it('tells teams without a session token from no teams at all', async () => {
    const noToken = await fixture({ team: { ...team, token: 'not-a-token' }, cookie: 'c', keychainPassword: 'p', staleTeam: { ...team, token: 'xoxp-nope' } })
    await expect(readSlackAppSession({ dir: noToken, keychainPassword: 'p' })).rejects.toMatchObject(new SlackAppImportError('no-token'))
    const noTeams = await fixture({ team, cookie: 'c', keychainPassword: 'p', emptyTeams: true })
    await expect(readSlackAppSession({ dir: noTeams, keychainPassword: 'p' })).rejects.toMatchObject(new SlackAppImportError('no-team'))
  })

  it('asks for the next password while one does not decrypt the cookie', async () => {
    const dir = await fixture({ team, cookie: 'second-d', keychainPassword: 'second' })
    const asked: Array<number> = []
    const passwords = ['first', 'second']
    const session = await readSlackAppSession({
      dir,
      keychainPassword: async (attempt) => {
        asked.push(attempt)
        return passwords[attempt]
      },
    })
    expect(session.cookie.value).toBe('second-d')
    expect(asked).toEqual([0, 1])
  })
})

describe('locateSlackAppData', () => {
  async function home() {
    const root = await tempDir()
    const [direct, appStore] = slackAppCandidates(root)
    return { root, direct: direct!, appStore: appStore! }
  }

  it('finds the direct download with its Cookies file', async () => {
    const { root, direct } = await home()
    await fixture({ team, cookie: 'c', keychainPassword: 'p' }, direct.dir)
    const location = await locateSlackAppData(slackAppCandidates(root))
    expect(location).toMatchObject({ found: true, data: { ...direct, cookiesFile: 'Cookies' } })
    expect(location.checked).toMatchObject([
      { variant: 'direct', exists: true, localStorage: true, cookiesFile: 'Cookies' },
      { variant: 'app-store', exists: false, localStorage: false },
    ])
  })

  it('finds the App Store container with Network/Cookies', async () => {
    const { root, appStore } = await home()
    await fixture({ team, cookie: 'c', keychainPassword: 'p', cookiesFile: 'Network/Cookies' }, appStore.dir)
    const location = await locateSlackAppData(slackAppCandidates(root))
    expect(location).toMatchObject({ found: true, data: { ...appStore, cookiesFile: join('Network', 'Cookies') } })
  })

  it('prefers the install written most recently when both exist', async () => {
    const { root, direct, appStore } = await home()
    await fixture({ team, cookie: 'c', keychainPassword: 'p' }, direct.dir)
    await fixture({ team, cookie: 'c', keychainPassword: 'p' }, appStore.dir)
    await touch(direct.dir, 1_000_000)
    await touch(appStore.dir, 2_000_000)
    expect(await locateSlackAppData(slackAppCandidates(root))).toMatchObject({ found: true, data: { variant: 'app-store' } })
    await touch(direct.dir, 3_000_000)
    expect(await locateSlackAppData(slackAppCandidates(root))).toMatchObject({ found: true, data: { variant: 'direct' } })
  })

  it('tells a missing install from one without a session', async () => {
    const { root, direct } = await home()
    expect(await locateSlackAppData(slackAppCandidates(root))).toMatchObject({ found: false, reason: 'not-installed' })
    await mkdir(join(direct.dir, 'Local Storage', 'leveldb'), { recursive: true })
    expect(await locateSlackAppData(slackAppCandidates(root))).toMatchObject({ found: false, reason: 'signed-out' })
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
