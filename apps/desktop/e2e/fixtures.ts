import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startFakeSlack, writeSlackAppFixture, type Credentials, type FakeSlack } from '@juno/fake-slack'
import { Juno } from './driver/juno'

/** What main exposes on `globalThis.junoTest` under JUNO_E2E. */
export interface JunoTestHooks {
  readonly enginePid: () => number | undefined
  readonly engineState: () => string
  /** Makes the supervisor give up on the engine, as after too many crashes. */
  readonly failEngine: () => void
}

export interface RunningApp {
  readonly app: ElectronApplication
  readonly win: Page
  readonly close: () => Promise<void>
}

/** A throwaway user-data directory. Delete it with `rm` when done. */
export function tempUserData(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'juno-e2e-'))
}

export interface LaunchOptions {
  /** The fake Slack the app signs in against (sign-in window, socket allow-list). */
  readonly fakeSlackUrl?: string
  /** A fixture Slack-app directory for "Use the Slack app's session". */
  readonly slackAppDir?: string
  /** The stand-in for the "Slack Safe Storage" keychain password. */
  readonly keychainPassword?: string
}

/**
 * Launches the built app (run `pnpm build` first) on the given user-data
 * directory and waits for its first window. Launch the same directory twice
 * to test what survives a relaunch.
 */
export async function launchApp(userData: string, options: LaunchOptions = {}): Promise<RunningApp> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  env.JUNO_USER_DATA = userData
  env.JUNO_E2E = '1'
  if (options.fakeSlackUrl !== undefined) env.JUNO_FAKE_SLACK_URL = options.fakeSlackUrl
  if (options.slackAppDir !== undefined) env.JUNO_SLACK_APP_DIR = options.slackAppDir
  if (options.keychainPassword !== undefined) env.JUNO_SLACK_SAFE_STORAGE_PASSWORD = options.keychainPassword

  // Launch the package directory (like `electron .`), not the script, so
  // Electron reads package.json for the app name and version.
  const app = await electron.launch({
    args: [resolve(__dirname, '..')],
    env,
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  return { app, win, close: () => app.close() }
}

/** The fixture Slack-app directory the app imports from, written with one of the fake's sessions. */
export interface SlackAppFixture {
  readonly dir: string
  readonly keychainPassword: string
  readonly credentials: Credentials
}

export const KEYCHAIN_PASSWORD = 'fixture-keychain-password'

export async function writeSlackApp(fake: FakeSlack, dir: string): Promise<SlackAppFixture> {
  const credentials = fake.signIn()
  await writeSlackAppFixture(dir, {
    team: { id: fake.teamId, name: 'Juno Fake', domain: 'juno-fake', url: `${fake.url}/`, token: credentials.token, userId: credentials.userId },
    cookie: credentials.cookie,
    keychainPassword: KEYCHAIN_PASSWORD,
  })
  return { dir, keychainPassword: KEYCHAIN_PASSWORD, credentials }
}

export interface Fixtures {
  /** A fake Slack per test. */
  readonly fake: FakeSlack
  /** A fixture Slack-app directory with one of the fake's sessions. */
  readonly slackApp: SlackAppFixture
  readonly userData: string
  readonly running: RunningApp
  readonly app: ElectronApplication
  readonly win: Page
  readonly juno: Juno
}

/** Launches the app once per test with a fresh user-data directory, against its own fake Slack. */
export const test = base.extend<Fixtures>({
  // Playwright requires the destructuring pattern even with no dependencies.
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack()
    await use(fake)
    await fake.close()
  },
  slackApp: async ({ fake }, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'juno-slack-app-'))
    await use(await writeSlackApp(fake, dir))
    await rm(dir, { recursive: true, force: true })
  },
  // oxlint-disable-next-line no-empty-pattern
  userData: async ({}, use) => {
    const userData = await tempUserData()
    await use(userData)
    await rm(userData, { recursive: true, force: true })
  },
  running: async ({ fake, slackApp, userData }, use) => {
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
    await use(running)
    await running.close()
  },
  app: async ({ running }, use) => {
    await use(running.app)
  },
  win: async ({ running }, use) => {
    await use(running.win)
  },
  juno: async ({ running }, use) => {
    await use(new Juno(running.app, running.win))
  },
})

/** Reads one of main's test hooks. */
export function hooks<K extends keyof JunoTestHooks>(app: ElectronApplication, name: K): Promise<ReturnType<JunoTestHooks[K]>> {
  return app.evaluate((_electron, hook) => {
    const testHooks = (globalThis as unknown as { junoTest: JunoTestHooks }).junoTest
    return testHooks[hook]() as ReturnType<JunoTestHooks[K]>
  }, name)
}

export { expect } from '@playwright/test'
