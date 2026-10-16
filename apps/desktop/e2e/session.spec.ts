// Sign-in and session, end to end: the sign-in window against the fake's
// sign-in page, the Slack-app import through the test seam, sign-out, and
// the session expiring under the app.
import { readFile, access, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, launchApp, test, writeSlackApp } from './fixtures'
import { Juno } from './driver/juno'

test('starts signed out with the sign-in page', async ({ juno, win }) => {
  await juno.expectSignedOut()
  await expect(juno.signInButton).toBeVisible()
  await expect(juno.importButton).toBeVisible()
  await expect(win.getByText('macOS will ask for access to the Slack keychain item.')).toBeVisible()
  await expect(win.getByRole('status', { name: 'Engine status' })).toHaveCount(0)
})

test('signs in through Slack’s sign-in page: the token and cookie are captured and the session verified', async ({ juno, fake, userData }) => {
  await juno.expectSignedOut()
  await juno.signIn()
  await juno.expectSignedIn('Juno Fake')

  // The engine verified the session with the captured token and cookie...
  expect(fake.callCount('auth.test')).toBe(1)
  expect(fake.calls.find((call) => call.method === 'auth.test')?.ok).toBe(true)
  // ...and holds a socket open through main's cookie handshake.
  await expect.poll(() => fake.socketCount(), { timeout: 10_000 }).toBe(1)
  // The verified secrets are on disk (plain JSON under JUNO_E2E) and the engine is live.
  const stored = JSON.parse(await readFile(join(userData, 'secrets.bin'), 'utf8')) as { teamId: string; token: string }
  expect(stored.teamId).toBe(fake.teamId)
  expect(stored.token.startsWith('xoxc-')).toBe(true)
  await juno.openSettings('About')
  await expect(juno.settings.engineStatus).toHaveText('Engine live')
})

test('comes back signed in after a relaunch', async ({ juno, fake, userData, running }) => {
  await juno.signIn()
  await juno.expectSignedIn('Juno Fake')
  // The signed-in UI precedes main's asynchronous write. Relaunch only after the session is on disk.
  await expect.poll(async () => {
    try {
      const stored: unknown = JSON.parse(await readFile(join(userData, 'secrets.bin'), 'utf8'))
      return typeof stored === 'object' && stored !== null && 'teamId' in stored ? stored.teamId : undefined
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && 'code' in error && error.code === 'ENOENT')) return undefined
      throw error
    }
  }).toBe(fake.teamId)
  await running.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url })
  try {
    await new Juno(again.app, again.win).expectSignedIn('Juno Fake')
    expect(fake.callCount('auth.test')).toBe(2)
  } finally {
    await again.close()
  }
})

test('comes back signed in when the local cache is damaged, and syncs it again', async ({ juno, fake, userData, running, slackApp }) => {
  await juno.signIn()
  await juno.waitForSync()
  await running.close()
  const [workspace] = await readdir(join(userData, 'workspaces'))
  await writeFile(join(userData, 'workspaces', workspace!, 'cache.db'), 'not a database '.repeat(400))

  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const restarted = new Juno(again.app, again.win)
    await restarted.expectSignedIn('Juno Fake')
    await restarted.sidebar.row('Draft plan is in the doc').expectVisible()
  } finally {
    await again.close()
  }
})

test('says so when the sign-in window is closed early', async ({ juno }) => {
  await juno.abandonSignIn()
  await juno.expectSignInError('The sign-in window was closed before it finished.')
  await expect(juno.signInButton).toBeEnabled()
})

test('signs out: the secrets, the cookies and the session are gone', async ({ juno, fake, userData }) => {
  await juno.signIn()
  await juno.expectSignedIn('Juno Fake')
  await expect.poll(() => fake.socketCount(), { timeout: 10_000 }).toBe(1)

  await juno.signOut()

  await juno.expectSignedOut()
  await expect(access(join(userData, 'secrets.bin'))).rejects.toThrow()
  await expect.poll(() => fake.socketCount(), { timeout: 10_000 }).toBe(0)
  // A relaunch would find nothing: the next sign-in starts from the sign-in page again.
  await juno.signIn()
  await juno.expectSignedIn('Juno Fake')
})

test('returns to the sign-in page when Slack expires the session', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.expectSignedIn('Juno Fake')
  await expect.poll(() => fake.socketCount(), { timeout: 10_000 }).toBe(1)

  fake.expireSession()

  await juno.expectSessionExpired()
  await expect(juno.signInButton).toBeVisible()
  // Signing in again replaces the expired session.
  await juno.signIn()
  await juno.expectSignedIn('Juno Fake')
})

test('imports the Slack app’s session through the test seam', async ({ juno, fake, slackApp }) => {
  await juno.expectSignedOut()
  await juno.importFromSlackApp()
  await juno.expectSignedIn('Juno Fake')
  // The imported token and decrypted cookie are the fixture's, and they work.
  const authTest = fake.calls.find((call) => call.method === 'auth.test')
  expect(authTest?.ok).toBe(true)
  await expect.poll(() => fake.socketCount(), { timeout: 10_000 }).toBe(1)
  expect(slackApp.credentials.userId).toBe(fake.selfId)
})

test('imports a Slack app whose cookie store is at Network/Cookies', async ({ fake, userData }) => {
  const dir = join(userData, 'slack-network-cookies')
  const slackApp = await writeSlackApp(fake, dir, { cookiesFile: 'Network/Cookies' })
  const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const juno = new Juno(running.app, running.win)
    await juno.importFromSlackApp()
    await juno.expectSignedIn('Juno Fake')
    expect(fake.calls.find((call) => call.method === 'auth.test')?.ok).toBe(true)
  } finally {
    await running.close()
  }
})

test('explains a Mac without Slack', async ({ fake, userData }) => {
  const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: join(userData, 'no-such-dir'), keychainPassword: 'x' })
  try {
    const juno = new Juno(running.app, running.win)
    await juno.importFromSlackApp({ skipSetUp: false })
    await juno.expectSignInError('Slack isn’t installed on this Mac.')
    await juno.expectSignedOut()
  } finally {
    await running.close()
  }
})

test('explains a Slack app that is not signed in', async ({ fake, userData }) => {
  const slackApp = await writeSlackApp(fake, join(userData, 'slack-signed-out'), { signedOut: true })
  const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const juno = new Juno(running.app, running.win)
    await juno.importFromSlackApp({ skipSetUp: false })
    await juno.expectSignInError('Slack is installed but not signed in. Sign in to Slack in its app first, or use Sign in to Slack.')
    await juno.expectSignedOut()
  } finally {
    await running.close()
  }
})

test('explains a keychain password that does not unlock the cookie', async ({ fake, slackApp, userData }) => {
  const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: 'wrong' })
  try {
    const juno = new Juno(running.app, running.win)
    await juno.importFromSlackApp({ skipSetUp: false })
    await juno.expectSignInError(/keychain item/)
    await juno.expectSignedOut()
  } finally {
    await running.close()
  }
})
