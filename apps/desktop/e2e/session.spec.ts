// Sign-in, as main does it: one cold launch that imports the Slack app's session through the keychain, relaunches
// on the stored session, signs out and back in, and has Slack expire it. The importer's failures (no Slack, signed
// out, a wrong keychain password) are in apps/desktop/test/slackAppData.test.ts.
import { execFile } from 'node:child_process'
import { readFile, access, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'
import { expect, hooks, launchApp, test, writeSlackApp, type LaunchOptions } from './fixtures'
import { Juno } from './driver/juno'

/** Names that would hand the page Electron's raw IPC rather than one route of the bridge. */
const RAW_IPC = ['ipcRenderer', 'send', 'sendSync', 'invoke', 'on', 'once', 'postMessage', 'removeAllListeners']

// The method names are JunoBridge's, which the compiler checks; this checks what
// only a running preload shows: no Node globals, and only functions cross.
async function onlyTheBridge(win: Page): Promise<void> {
  const exposed = await win.evaluate(() => {
    const globals = window as unknown as Record<string, unknown>
    const members = Object.entries(window.juno as unknown as Record<string, unknown>).flatMap(([group, value]) =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).map(([name, member]) => ({ group, name, type: typeof member }))
        : [{ group, name: '', type: typeof value }])
    return { require: typeof globals['require'], process: typeof globals['process'], ipcRenderer: typeof globals['ipcRenderer'], members }
  })
  expect(exposed.require).toBe('undefined')
  expect(exposed.process).toBe('undefined')
  expect(exposed.ipcRenderer).toBe('undefined')
  expect(exposed.members.length).toBeGreaterThan(0)
  // Each group holds functions only: no nested object, such as ipcRenderer itself, and no value.
  expect(exposed.members.filter((member) => member.type !== 'function')).toEqual([])
  expect(exposed.members.filter((member) => RAW_IPC.includes(member.name))).toEqual([])
}

/** A second process on the same data folder exits at once and brings the open window forward. */
async function secondLaunchHandsOver({ app, win }: { readonly app: Juno['app']; readonly win: Page }, userData: string): Promise<void> {
  const launch = await app.evaluate(({ app: electron }) => ({ executable: process.execPath, path: electron.getAppPath(), userData: electron.getPath('userData') }))
  expect(launch.userData).toBe(userData)
  const handover = await app.evaluateHandle(({ app: electron }) => {
    const received = { count: 0 }
    electron.on('second-instance', () => { received.count += 1 })
    return received
  })
  const mainWindow = await app.browserWindow(win)
  // Xvfb has no window manager to handle minimize on the Linux runner.
  if (process.platform === 'darwin') {
    await mainWindow.evaluate((window) => window.minimize())
    await expect.poll(() => mainWindow.evaluate((window) => window.isMinimized())).toBe(true)
  }
  // This process should exit before opening a window. Playwright's launcher
  // waits for debugging endpoints, so use a normal launch and require exit 0.
  const env: NodeJS.ProcessEnv = { ...process.env, JUNO_USER_DATA: userData, JUNO_E2E: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  // Match Playwright's Linux launch flags for the remote container.
  const args = process.platform === 'linux' ? ['--no-sandbox', launch.path] : [launch.path]
  await promisify(execFile)(launch.executable, args, { env, timeout: 30_000 })
  await expect.poll(() => handover.evaluate((received) => received.count)).toBe(1)
  await expect.poll(() => mainWindow.evaluate((window) => window.isMinimized())).toBe(false)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
}

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

test('a relaunch whose session Slack no longer accepts shows "Slack signed you out", then opens on it', { tag: ['@electron', '@heavy', '@heavy-crash'] }, async ({ juno, fake, userData, running }) => {
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

// macOS has not been asked about notifications yet, and the user says no when it asks.
test('sign-in: the preload and a second launch, importing the Slack app’s session, a relaunch that opens on the shell, signing out, and Slack expiring the session', { tag: '@electron' }, async ({ fake, slackApp, userData }) => {
  test.setTimeout(120_000)
  const options: LaunchOptions = { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, notificationInitial: 'notDetermined', notificationResponse: 'denied' }
  const first = await launchApp(userData, options)
  try {
    const juno = new Juno(first.app, first.win)
    await juno.expectSignedOut()
    await test.step('the preload exposes only the isolated bridge', () => onlyTheBridge(first.win))
    await test.step('a second launch on the same data hands over to the open window', async () => {
      await secondLaunchHandsOver(first, userData)
      await expect(juno.importButton).toBeVisible()
    })

    await test.step('imports the token and cookie and verifies the session; macOS is asked about notifications once', async () => {
      await juno.signIn()
      await juno.expectSignedIn('Juno Fake')
      // The engine verified the session with the captured token and cookie...
      expect(fake.callCount('auth.test')).toBe(1)
      expect(await juno.slackKeychainReads()).toBe(1)
      expect(fake.calls.find((call) => call.method === 'auth.test')?.ok).toBe(true)
      // ...and holds a socket open through main's cookie handshake.
      await expect.poll(() => fake.socketCount(), { timeout: 10_000 }).toBe(1)
      // The verified secrets are on disk (plain JSON under JUNO_E2E) and the engine is live.
      const stored = JSON.parse(await readFile(join(userData, 'secrets.bin'), 'utf8')) as { teamId: string; token: string }
      expect(stored.teamId).toBe(fake.teamId)
      expect(stored.token.startsWith('xoxc-')).toBe(true)
      await expect.poll(() => hooks(first.app, 'notificationRequests')).toBe(1)
      await juno.waitForSync()
      await sessionSaved(userData, fake.teamId)
    })
  } finally {
    await first.close()
  }

  // Slack is slow to answer: the engine stays `starting` until the test lets auth.test through.
  fake.holdNext({ method: 'auth.test' })
  // Deliberately report notDetermined again: a denied prompt must not repeat.
  const again = await launchApp(userData, options)
  try {
    const juno = new Juno(again.app, again.win)
    await test.step('a relaunch opens on the shell and never paints the sign-in page while Slack checks the session', async () => {
      const stop = await watchSignInFrames(again.win)
      await expect.poll(() => fake.heldCount({ method: 'auth.test' }), { timeout: 15_000 }).toBe(1)
      // The shell and the cached rows, from before Slack has answered.
      await juno.sidebar.row('Draft plan is in the doc').expectVisible()
      await expect.poll(() => again.win.evaluate(() => (window as unknown as { __signInFrames: SignInFrames }).__signInFrames.frames)).toBeGreaterThan(10)
      fake.release({ method: 'auth.test' })
      await juno.expectSignedIn('Juno Fake')
      const frames = await stop()
      await test.info().attach('relaunch-frames', { body: JSON.stringify(frames, null, 2), contentType: 'application/json' })
      expect(frames.frames).toBeGreaterThan(10)
      expect(frames.signIn, 'frames with the sign-in page').toBe(0)
      expect(frames.shell, 'frames with the sidebar').toBe(frames.frames)
      // The stored session, without the keychain.
      expect(fake.callCount('auth.test')).toBe(2)
      expect(await juno.slackKeychainReads()).toBe(0)
    })

    await test.step('the denied notification request is not asked again; Allow notifications asks', async () => {
      await juno.waitForSync()
      expect(await hooks(again.app, 'notificationRequests')).toBe(0)
      await juno.openNotifications()
      await juno.notifications.root.getByRole('button', { name: 'Allow notifications' }).click()
      await expect.poll(() => hooks(again.app, 'notificationRequests')).toBe(1)
    })

    await test.step('signs out: the secrets, the cookies and the session are gone', async () => {
      await expect.poll(() => fake.socketCount(), { timeout: 10_000 }).toBe(1)
      await juno.signOut()
      await juno.expectSignedOut()
      await expect(access(join(userData, 'secrets.bin'))).rejects.toThrow()
      // Nor the saved session, so the next launch does not open on the shell.
      await expect.poll(async () => (JSON.parse(await readFile(join(userData, 'launch.json'), 'utf8')) as { session?: unknown }).session).toBeUndefined()
      await expect.poll(() => fake.socketCount(), { timeout: 10_000 }).toBe(0)
      await juno.signIn()
      await juno.expectSignedIn('Juno Fake')
    })

    await test.step('returns to the sign-in page when Slack expires the session, and importing again replaces it', async () => {
      await expect.poll(() => fake.socketCount(), { timeout: 10_000 }).toBe(1)
      fake.expireSession()
      await juno.expectSessionExpired()
      await expect(juno.importButton).toBeVisible()
      // Stand in for signing in again in the installed Slack app.
      await rm(slackApp.dir, { recursive: true, force: true })
      await writeSlackApp(fake, slackApp.dir)
      await juno.signIn()
      await juno.expectSignedIn('Juno Fake')
    })
  } finally {
    await again.close()
  }
})
