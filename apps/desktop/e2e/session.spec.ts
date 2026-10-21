// Session import, sign-out, relaunch and expiry against the fake Slack app.
import { readFile, access, readdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, launchApp, test, writeSlackApp } from './fixtures'
import { Juno } from './driver/juno'

test('signed out at launch, then imports and verifies the Slack app’s session', async ({ juno, win, fake, userData }) => {
  await test.step('starts signed out with one primary action', async () => {
    await juno.expectSignedOut()
    await expect(juno.importButton).toBeVisible()
    await expect(win.getByRole('button', { name: 'Sign in to Slack', exact: true })).toHaveCount(0)
    await expect(win.getByText("I'll use the Slack app on this Mac to sort your conversations into topics. Nothing is sent without you.")).toBeVisible()
    await expect(win.getByText('macOS will ask once for your Mac password so Juno can read Slack’s keychain item.')).toBeVisible()
    await expect(win.getByRole('status', { name: 'Engine status' })).toHaveCount(0)
    await win.screenshot({ path: test.info().outputPath('slack-session-sign-in.png') })
  })

  await test.step('imports the token and cookie and verifies the session', async () => {
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
})

test('comes back signed in after a relaunch', async ({ juno, fake, userData, running }) => {
  await juno.signIn()
  await juno.expectSignedIn('Juno Fake')
  // Quit as soon as the ready UI appears; ready now includes the durable store acknowledgement.
  await running.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url })
  try {
    await new Juno(again.app, again.win).expectSignedIn('Juno Fake')
    expect(fake.callCount('auth.test')).toBe(2)
  } finally {
    await again.close()
  }
})

/** Resolves once main has saved the verified session for the next launch's first frame (`launch.json`). */
async function sessionSaved(userData: string, teamId: string): Promise<void> {
  await expect.poll(async () => {
    try {
      const launch = JSON.parse(await readFile(join(userData, 'launch.json'), 'utf8')) as { session?: { teamId?: string } }
      return launch.session?.teamId
    } catch {
      return undefined
    }
  }).toBe(teamId)
}

interface SignInFrames {
  frames: number
  signIn: number
  shell: number
  missing: Array<{ frame: number; at: number; rootChildren: number; hadShell: boolean; bundleStarted: boolean; shellPainted: boolean }>
}

/**
 * Samples every frame from now on: whether the sign-in page or the sidebar is on screen.
 * Playwright attaches only after the first page has started, so the test also holds
 * Slack's `auth.test` to keep the engine checking the session while it watches.
 */
async function watchSignInFrames(win: Page): Promise<() => Promise<SignInFrames>> {
  await win.evaluate(() => {
    const state: SignInFrames & { on: boolean } = { signIn: 0, shell: 0, frames: 0, missing: [], on: true }
    Object.assign(window, { __signInFrames: state })
    const tick = () => {
      state.frames += 1
      if (document.getElementById('sign-in-title') !== null) state.signIn += 1
      if (document.querySelector('aside[aria-label="Sidebar"]') !== null) state.shell += 1
      else state.missing.push({
        frame: state.frames,
        at: performance.now(),
        rootChildren: document.getElementById('root')?.childElementCount ?? 0,
        hadShell: state.shell > 0,
        bundleStarted: performance.getEntriesByName('juno.start').length > 0,
        shellPainted: performance.getEntriesByName('juno.shell-paint').length > 0,
      })
      if (state.on) requestAnimationFrame(tick)
    }
    tick()
  })
  return () =>
    win.evaluate(() => {
      const state = (window as unknown as { __signInFrames: SignInFrames & { on: boolean } }).__signInFrames
      state.on = false
      return { frames: state.frames, signIn: state.signIn, shell: state.shell, missing: state.missing }
    })
}

test('a relaunch opens on the shell and never paints the sign-in page while Slack checks the session', async ({ juno, fake, userData, running }) => {
  await juno.signIn()
  await juno.waitForSync()
  await sessionSaved(userData, fake.teamId)
  await running.close()

  // Slack is slow to answer: the engine stays `starting` until the test lets auth.test through.
  fake.holdNext({ method: 'auth.test' })
  const again = await launchApp(userData, { fakeSlackUrl: fake.url })
  try {
    const stop = await watchSignInFrames(again.win)
    const restarted = new Juno(again.app, again.win)
    await expect.poll(() => fake.heldCount({ method: 'auth.test' }), { timeout: 15_000 }).toBe(1)
    // The shell and the cached rows, from before Slack has answered.
    await restarted.sidebar.row('Draft plan is in the doc').expectVisible()
    await again.win.waitForTimeout(500)
    fake.release({ method: 'auth.test' })
    await restarted.expectSignedIn('Juno Fake')
    const frames = await stop()
    await test.info().attach('relaunch-frames', { body: JSON.stringify(frames, null, 2), contentType: 'application/json' })
    expect(frames.frames).toBeGreaterThan(10)
    expect(frames.signIn, 'frames with the sign-in page').toBe(0)
    expect(frames.shell, 'frames with the sidebar').toBe(frames.frames)
  } finally {
    await again.close()
  }
})

test('a relaunch whose session Slack no longer accepts shows "Slack signed you out", then opens on it', async ({ juno, fake, userData, running }) => {
  await juno.signIn()
  await juno.expectSignedIn('Juno Fake')
  await sessionSaved(userData, fake.teamId)
  await running.close()
  fake.expireSession()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url })
  try {
    await new Juno(again.app, again.win).expectSessionExpired()
    // The saved session is dropped, so the next launch does not open on the shell first.
    await expect.poll(async () => (JSON.parse(await readFile(join(userData, 'launch.json'), 'utf8')) as { session?: unknown }).session).toBeUndefined()
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

// Signing out ends with a fresh sign-in, which the expiry step starts from.
test('signing out, and Slack expiring the session, both return to the sign-in page', async ({ juno, win, fake, userData, slackApp }) => {
  await test.step('signs out: the secrets, the cookies and the session are gone', async () => {
    await juno.signIn()
    await juno.expectSignedIn('Juno Fake')
    await expect.poll(() => fake.socketCount(), { timeout: 10_000 }).toBe(1)

    await juno.signOut()

    await juno.expectSignedOut()
    await expect(access(join(userData, 'secrets.bin'))).rejects.toThrow()
    // Nor the saved session, so the next launch does not open on the shell.
    await expect.poll(async () => (JSON.parse(await readFile(join(userData, 'launch.json'), 'utf8')) as { session?: unknown }).session).toBeUndefined()
    await expect.poll(() => fake.socketCount(), { timeout: 10_000 }).toBe(0)
    // A relaunch would find nothing: the next sign-in starts from the sign-in page again.
    await juno.signIn()
    await juno.expectSignedIn('Juno Fake')
  })

  await test.step('returns to the sign-in page when Slack expires the session', async () => {
    // Signed in by the step above.
    await juno.expectSignedIn('Juno Fake')
    await expect.poll(() => fake.socketCount(), { timeout: 10_000 }).toBe(1)

    fake.expireSession()

    await juno.expectSessionExpired()
    await expect(juno.importButton).toBeVisible()
    await expect(win.getByText('The Slack app’s session ended. Open Slack, sign in there, then try again. Your topics and settings are kept.')).toBeVisible()
    // Stand in for signing in again in the installed Slack app.
    await rm(slackApp.dir, { recursive: true, force: true })
    await writeSlackApp(fake, slackApp.dir)
    // Importing again replaces the expired session.
    await juno.signIn()
    await juno.expectSignedIn('Juno Fake')
  })
})

test('imports the Slack app’s session through the test seam', async ({ juno, fake, slackApp }) => {
  await juno.expectSignedOut()
  await juno.importFromSlackApp()
  await juno.expectSignedIn('Juno Fake')
  // One keychain read, which is one macOS prompt outside tests.
  expect(await juno.slackKeychainReads()).toBe(1)
  // The imported token and decrypted cookie are the fixture's, and they work.
  const authTest = fake.calls.find((call) => call.method === 'auth.test')
  expect(authTest?.ok).toBe(true)
  await expect.poll(() => fake.socketCount(), { timeout: 10_000 }).toBe(1)
  expect(slackApp.credentials.userId).toBe(fake.selfId)
})

test('explains a Mac without Slack', async ({ fake, userData }) => {
  const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: join(userData, 'no-such-dir'), keychainPassword: 'x' })
  try {
    const juno = new Juno(running.app, running.win)
    await juno.importFromSlackApp({ skipSetUp: false })
    await juno.expectSignInError('Slack isn’t installed on this Mac. Install Slack, sign in to it, then try again.')
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
    await juno.expectSignInError('Slack is installed but not signed in. Open Slack, sign in there, then try again.')
    await juno.expectSignedOut()
    // "Copy details" gives a report of where the import stopped, with no cookie or token in it.
    const details = await juno.copySignInDetails()
    expect(details).toContain('Failed at: signed out: the cookie database has no d cookie')
    expect(details).toContain('Keychain: not asked')
    expect(details).not.toMatch(/xox|d=/)
    expect(details).not.toContain(slackApp.credentials.cookie)
  } finally {
    await running.close()
  }
})

test('explains a keychain password that does not unlock the cookie, and does not ask for it again', async ({ fake, slackApp, userData }) => {
  const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: 'wrong' })
  try {
    const juno = new Juno(running.app, running.win)
    await juno.importFromSlackApp({ skipSetUp: false })
    await juno.expectSignInError('The Slack keychain item did not unlock the session cookie. Open Slack, sign in there, then try again.')
    await juno.expectSignedOut()
    // A second press reuses the password from the first: the keychain is read once.
    await juno.importFromSlackApp({ skipSetUp: false })
    await expect.poll(() => juno.copySignInDetails(), { timeout: 15_000 }).toContain('"Slack Safe Storage" found, allowed earlier in this run, did not unlock the cookie')
    await juno.expectSignInError('The Slack keychain item did not unlock the session cookie. Open Slack, sign in there, then try again.')
    expect(await juno.slackKeychainReads()).toBe(1)
  } finally {
    await running.close()
  }
})
