// The Slack app import as main runs it, minus Electron: synthetic Slack data
// shaped like each install, and a fake keychain. Each case ends in the line
// the sign-in page shows.
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeSlackAppFixture } from '@juno/fake-slack'
import { slackAppCandidates } from '@juno/slack/import'
import { NO_KEYCHAIN, NOT_INSTALLED, readSlackApp, SIGNED_OUT, WRONG_KEYCHAIN } from '../src/main/slackAppData'

const homes: Array<string> = []
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

const team = { id: 'T0JUNO', name: 'Juno Fake', domain: 'juno-fake', url: 'https://juno-fake.slack.com/', token: 'xoxc-test-0000', userId: 'U0TEST' }
const PASSWORD = 'test-keychain-password'

async function home() {
  const root = await mkdtemp(join(tmpdir(), 'juno-home-'))
  homes.push(root)
  const [direct, appStore] = slackAppCandidates(root)
  return { candidates: slackAppCandidates(root), direct: direct!.dir, appStore: appStore!.dir }
}

/** Reads with a keychain that answers `password` (null: the user declined) and records every service asked for. */
async function read(candidates: ReturnType<typeof slackAppCandidates>, password: string | null = PASSWORD) {
  const asked: Array<string> = []
  const logs: Array<string> = []
  const result = await readSlackApp({
    candidates,
    keychainPassword: async (service) => {
      asked.push(service)
      return password ?? undefined
    },
    log: (line) => logs.push(line),
  })
  return { result, asked, logs }
}

describe('readSlackApp', () => {
  it('imports from the App Store container with Network/Cookies and logs only where it looked', async () => {
    const { candidates, appStore } = await home()
    await writeSlackAppFixture(appStore, { team, cookie: 'synthetic-d', keychainPassword: PASSWORD, cookiesFile: 'Network/Cookies' })
    const { result, asked, logs } = await read(candidates)
    expect(result).toMatchObject({ ok: true, team: { id: 'T0JUNO' }, cookie: { value: 'synthetic-d' } })
    expect(asked).toEqual(['Slack Safe Storage'])
    expect(logs).toEqual([`main: slack import using app-store data, cookies at ${join('Network', 'Cookies')}`])
  })

  it('imports from the direct download with Cookies', async () => {
    const { candidates, direct } = await home()
    await writeSlackAppFixture(direct, { team, cookie: 'synthetic-d', keychainPassword: PASSWORD })
    const { result, logs } = await read(candidates)
    expect(result).toMatchObject({ ok: true, cookie: { value: 'synthetic-d' } })
    expect(logs).toEqual(['main: slack import using direct data, cookies at Cookies'])
  })

  it('says Slack is not installed when no Slack data exists', async () => {
    const { candidates } = await home()
    const { result, asked } = await read(candidates)
    expect(result).toEqual({ ok: false, kind: 'no-slack-app', message: NOT_INSTALLED })
    expect(asked).toEqual([])
  })

  it('says Slack is not signed in when its directory has no cookie store', async () => {
    const { candidates, direct } = await home()
    await mkdir(join(direct, 'Local Storage', 'leveldb'), { recursive: true })
    const { result, asked } = await read(candidates)
    expect(result).toEqual({ ok: false, kind: 'slack-signed-out', message: SIGNED_OUT })
    expect(asked).toEqual([])
  })

  it('says Slack is not signed in when there is no d cookie, without a keychain prompt', async () => {
    const { candidates, direct } = await home()
    await writeSlackAppFixture(direct, { team, cookie: 'unused', keychainPassword: PASSWORD, signedOut: true })
    const { result, asked } = await read(candidates)
    expect(result).toEqual({ ok: false, kind: 'slack-signed-out', message: SIGNED_OUT })
    expect(asked).toEqual([])
  })

  it('explains a declined keychain prompt', async () => {
    const { candidates, direct } = await home()
    await writeSlackAppFixture(direct, { team, cookie: 'synthetic-d', keychainPassword: PASSWORD })
    const { result } = await read(candidates, null)
    expect(result).toEqual({ ok: false, kind: 'keychain', message: NO_KEYCHAIN })
  })

  it('explains a keychain password that does not unlock the cookie', async () => {
    const { candidates, direct } = await home()
    await writeSlackAppFixture(direct, { team, cookie: 'synthetic-d', keychainPassword: PASSWORD })
    const { result } = await read(candidates, 'wrong-password')
    expect(result).toEqual({ ok: false, kind: 'keychain', message: WRONG_KEYCHAIN })
  })
})
