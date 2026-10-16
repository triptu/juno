// The Slack app import as main runs it, minus Electron: synthetic Slack data
// shaped like each install, and a fake keychain. Each case ends in the line
// the sign-in page shows and the report "Copy details" gives.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeSlackAppFixture } from '@juno/fake-slack'
import { slackAppCandidates } from '@juno/slack/import'
import { NO_KEYCHAIN, NOT_INSTALLED, readSlackApp, securityKeychain, SIGNED_OUT, UNREADABLE, WRONG_KEYCHAIN, type SlackKeychain } from '../src/main/slackAppData'
import type { SecurityRunner } from '../src/main/keychain'

const homes: Array<string> = []
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

const team = { id: 'T0JUNO', name: 'Juno Fake', domain: 'juno-fake', url: 'https://juno-fake.slack.com/', token: 'xoxc-test-0000', userId: 'U0TEST' }
const PASSWORD = 'test-keychain-password'
const COOKIE = 'synthetic-d-cookie'

async function home() {
  const root = await mkdtemp(join(tmpdir(), 'juno-home-'))
  homes.push(root)
  const [direct, appStore] = slackAppCandidates(root)
  return { root, candidates: slackAppCandidates(root), direct: direct!.dir, appStore: appStore!.dir }
}

/** A keychain with these items. `null` is an item macOS refuses to give. Records every read. */
function keychainWith(items: Record<string, string | null>, accounts: Record<string, string> = {}) {
  const reads: Array<string> = []
  const keychain: SlackKeychain = {
    exists: async (service) => service in items,
    servicesFor: async (account) => (account in accounts ? [accounts[account]!] : []),
    read: async (service) => {
      reads.push(service)
      return items[service] ?? undefined
    },
  }
  return { keychain, reads }
}

async function read(root: string, candidates: ReturnType<typeof slackAppCandidates>, keychain: SlackKeychain, bundles: ReadonlyArray<string> = []) {
  const logs: Array<string> = []
  const result = await readSlackApp({ candidates, keychain, bundles, junoVersion: '0.1.0', macosVersion: '15.6', home: root, log: (line) => logs.push(line) })
  return { result, logs }
}

/** The report text: from `details` on a failure, from the log on success. */
function reportOf(outcome: Awaited<ReturnType<typeof read>>): string {
  const text = outcome.result.ok ? outcome.logs[0]!.replace('main: slack import report\n', '') : outcome.result.details
  // Whatever happened, the report carries no secret and is what main logged.
  expect(text).not.toMatch(/xox|d=/)
  expect(text).not.toContain(COOKIE)
  expect(text).not.toContain(PASSWORD)
  expect(outcome.logs).toEqual([`main: slack import report\n${text}`])
  return text
}

describe('readSlackApp', () => {
  it('imports from the App Store container with Network/Cookies and reports what it chose', async () => {
    const { root, candidates, appStore } = await home()
    await writeSlackAppFixture(appStore, { team, cookie: COOKIE, keychainPassword: PASSWORD, cookiesFile: 'Network/Cookies' })
    const { keychain, reads } = keychainWith({ 'Slack Safe Storage': PASSWORD })
    const outcome = await read(root, candidates, keychain)
    expect(outcome.result).toMatchObject({ ok: true, team: { id: 'T0JUNO' }, cookie: { value: COOKIE } })
    expect(reads).toEqual(['Slack Safe Storage'])
    const report = reportOf(outcome)
    expect(report).toContain('Juno 0.1.0, macOS 15.6')
    expect(report).toContain('  direct download: ~/Library/Application Support/Slack: not found')
    expect(report).toMatch(/ {2}App Store: ~\/Library\/Containers\/com\.tinyspeck\.slackmacgap\/Data\/Library\/Application Support\/Slack: exists, Local Storage yes, cookies at Network\/Cookies, modified \d{4}-/)
    expect(report).toContain('Chosen: App Store, Network/Cookies')
    expect(report).toContain('Keychain: "Slack Safe Storage" found, access allowed, unlocked the cookie')
    expect(report).toContain('Failed at: none, the session was read')
  })

  it('says Slack is not installed when no Slack data exists', async () => {
    const { root, candidates } = await home()
    const { keychain, reads } = keychainWith({})
    const outcome = await read(root, candidates, keychain)
    expect(outcome.result).toMatchObject({ ok: false, kind: 'no-slack-app', message: NOT_INSTALLED })
    expect(reads).toEqual([])
    const report = reportOf(outcome)
    expect(report).toContain('Chosen: none')
    expect(report).toContain('Keychain: not asked')
    expect(report).toContain('Failed at: no install: no Slack data folder exists')
  })

  it('reports a data folder without a cookie database as signed out', async () => {
    const { root, candidates, direct } = await home()
    await mkdir(join(direct, 'Local Storage', 'leveldb'), { recursive: true })
    const outcome = await read(root, candidates, keychainWith({}).keychain)
    expect(outcome.result).toMatchObject({ ok: false, kind: 'slack-signed-out', message: SIGNED_OUT })
    const report = reportOf(outcome)
    expect(report).toContain('  direct download: ~/Library/Application Support/Slack: exists, Local Storage yes, no cookie database')
    expect(report).toContain('Failed at: signed out: a Slack data folder has no Local Storage or no cookie database')
  })

  it('reports a missing d cookie as signed out, without a keychain prompt', async () => {
    const { root, candidates, direct } = await home()
    await writeSlackAppFixture(direct, { team, cookie: COOKIE, keychainPassword: PASSWORD, signedOut: true })
    const { keychain, reads } = keychainWith({ 'Slack Safe Storage': PASSWORD })
    const outcome = await read(root, candidates, keychain)
    expect(outcome.result).toMatchObject({ ok: false, kind: 'slack-signed-out', message: SIGNED_OUT })
    expect(reads).toEqual([])
    const report = reportOf(outcome)
    expect(report).toContain('Chosen: direct download, Cookies')
    expect(report).toContain('Failed at: signed out: the cookie database has no d cookie')
  })

  it('reports localConfig_v2 with no teams', async () => {
    const { root, candidates, direct } = await home()
    await writeSlackAppFixture(direct, { team, cookie: COOKIE, keychainPassword: PASSWORD, emptyTeams: true, staleTeam: { ...team, token: 'none' } })
    const outcome = await read(root, candidates, keychainWith({}).keychain)
    expect(outcome.result).toMatchObject({ ok: false, kind: 'slack-signed-out' })
    expect(reportOf(outcome)).toContain('Failed at: no team in localConfig: localConfig_v2 lists no teams')
  })

  it('reports Local Storage without localConfig_v2', async () => {
    const { root, candidates, direct } = await home()
    await writeSlackAppFixture(direct, { team, cookie: COOKIE, keychainPassword: PASSWORD })
    // Empty leveldb: the files are there, the record is not.
    await rm(join(direct, 'Local Storage', 'leveldb'), { recursive: true })
    await mkdir(join(direct, 'Local Storage', 'leveldb'), { recursive: true })
    const outcome = await read(root, candidates, keychainWith({}).keychain)
    expect(outcome.result).toMatchObject({ ok: false, kind: 'slack-signed-out' })
    expect(reportOf(outcome)).toContain('Failed at: no team in localConfig: Local Storage has no localConfig_v2')
  })

  it('reports teams without a session token', async () => {
    const { root, candidates, direct } = await home()
    await writeSlackAppFixture(direct, { team: { ...team, token: 'none' }, cookie: COOKIE, keychainPassword: PASSWORD, staleTeam: { ...team, token: 'none' } })
    const outcome = await read(root, candidates, keychainWith({}).keychain)
    expect(outcome.result).toMatchObject({ ok: false, kind: 'slack-signed-out' })
    expect(reportOf(outcome)).toContain('Failed at: token missing: no team in localConfig_v2 has a session token')
  })

  it('reports a refused keychain prompt', async () => {
    const { root, candidates, direct } = await home()
    await writeSlackAppFixture(direct, { team, cookie: COOKIE, keychainPassword: PASSWORD })
    const outcome = await read(root, candidates, keychainWith({ 'Slack Safe Storage': null }).keychain)
    expect(outcome.result).toMatchObject({ ok: false, kind: 'keychain', message: NO_KEYCHAIN })
    const report = reportOf(outcome)
    expect(report).toContain('Keychain: "Slack Safe Storage" found, access refused')
    expect(report).toContain('Failed at: keychain denied: macOS did not give the password')
  })

  it('reports a missing keychain item', async () => {
    const { root, candidates, direct } = await home()
    await writeSlackAppFixture(direct, { team, cookie: COOKIE, keychainPassword: PASSWORD })
    const outcome = await read(root, candidates, keychainWith({}).keychain)
    expect(outcome.result).toMatchObject({ ok: false, kind: 'keychain', message: NO_KEYCHAIN })
    const report = reportOf(outcome)
    expect(report).toContain('Keychain: "Slack Safe Storage" not found')
    expect(report).toContain('Failed at: keychain missing: no Slack keychain item was found')
  })

  it('reports a password that does not decrypt the cookie', async () => {
    const { root, candidates, direct } = await home()
    await writeSlackAppFixture(direct, { team, cookie: COOKIE, keychainPassword: PASSWORD })
    const { keychain, reads } = keychainWith({ 'Slack Safe Storage': 'wrong-password' }, { Slack: 'Other Safe Storage' })
    const outcome = await read(root, candidates, keychain)
    expect(outcome.result).toMatchObject({ ok: false, kind: 'keychain', message: WRONG_KEYCHAIN })
    // The direct download has one item; no other is tried.
    expect(reads).toEqual(['Slack Safe Storage'])
    const report = reportOf(outcome)
    expect(report).toContain('Keychain: "Slack Safe Storage" found, access allowed, did not unlock the cookie')
    expect(report).toContain('Failed at: cookie decrypt failed: no keychain password unlocked the d cookie')
  })

  it('tries the App Store build’s other Slack items and records the one that worked', async () => {
    const { root, candidates, appStore } = await home()
    await writeSlackAppFixture(appStore, { team, cookie: COOKIE, keychainPassword: PASSWORD })
    const { keychain, reads } = keychainWith(
      { 'Slack Safe Storage': 'wrong-password', 'Slack App Store Safe Storage': PASSWORD },
      { 'com.tinyspeck.slackmacgap': 'Slack App Store Safe Storage' },
    )
    const outcome = await read(root, candidates, keychain)
    expect(outcome.result).toMatchObject({ ok: true, cookie: { value: COOKIE } })
    expect(reads).toEqual(['Slack Safe Storage', 'Slack App Store Safe Storage'])
    expect(reportOf(outcome)).toContain(
      'Keychain: "Slack Safe Storage" found, access allowed, did not unlock the cookie; "Slack App Store Safe Storage" found, access allowed, unlocked the cookie',
    )
  })

  it('stops after a refused prompt instead of asking for another item', async () => {
    const { root, candidates, appStore } = await home()
    await writeSlackAppFixture(appStore, { team, cookie: COOKIE, keychainPassword: PASSWORD })
    const { keychain, reads } = keychainWith({ 'Slack Safe Storage': null, 'com.tinyspeck.slackmacgap Safe Storage': PASSWORD })
    const outcome = await read(root, candidates, keychain)
    expect(outcome.result).toMatchObject({ ok: false, kind: 'keychain', message: NO_KEYCHAIN })
    expect(reads).toEqual(['Slack Safe Storage'])
    expect(reportOf(outcome)).toContain('Failed at: keychain denied: macOS did not give the password')
  })

  it('reports data it cannot read by the error’s name only', async () => {
    const { root, candidates, direct } = await home()
    await writeSlackAppFixture(direct, { team, cookie: COOKIE, keychainPassword: PASSWORD })
    await writeFile(join(direct, 'Cookies'), 'not a database')
    const outcome = await read(root, candidates, keychainWith({ 'Slack Safe Storage': PASSWORD }).keychain)
    expect(outcome.result).toMatchObject({ ok: false, kind: 'other', message: UNREADABLE })
    expect(reportOf(outcome)).toMatch(/Failed at: the Slack data could not be read \(\w+\)$/)
  })

  it('names the Slack app’s version and build from its bundle', async () => {
    const { root, candidates } = await home()
    const bundle = join(root, 'Applications', 'Slack.app')
    await mkdir(join(bundle, 'Contents', '_MASReceipt'), { recursive: true })
    await writeFile(
      join(bundle, 'Contents', 'Info.plist'),
      '<?xml version="1.0"?><plist><dict><key>CFBundleShortVersionString</key>\n<string>4.52.178</string></dict></plist>',
    )
    const outcome = await read(root, candidates, keychainWith({}).keychain, [join(root, 'missing', 'Slack.app'), bundle])
    expect(reportOf(outcome)).toContain('Slack app: 4.52.178, App Store build, ~/Applications/Slack.app')
  })
})

describe('securityKeychain', () => {
  it('finds items by attributes without asking for the password, and reads the service name', async () => {
    const calls: Array<ReadonlyArray<string>> = []
    const run: SecurityRunner = async (args) => {
      calls.push(args)
      if (args.includes('-w')) return { code: 0, stdout: 'synthetic\n' }
      if (args[1] === '-a') return { code: 0, stdout: 'keychain: "login.keychain-db"\nattributes:\n    "svce"<blob>="Slack Safe Storage"\n' }
      return { code: args[2] === 'Slack Safe Storage' ? 0 : 44, stdout: '' }
    }
    const keychain = securityKeychain(run)
    expect(await keychain.exists('Slack Safe Storage')).toBe(true)
    expect(await keychain.exists('Missing')).toBe(false)
    expect(await keychain.servicesFor('Slack')).toEqual(['Slack Safe Storage'])
    // Only `read` passes -w, the flag that prints the password.
    expect(calls.filter((args) => args.includes('-w'))).toEqual([])
    expect(await keychain.read('Slack Safe Storage')).toBe('synthetic')
  })
})
